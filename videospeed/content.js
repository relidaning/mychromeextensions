(function () {
  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;
  const SEEK_STEP = 15; // seconds jumped per Left/Right arrow press
  let userDesiredRate = 1;

  function getActiveVideo() {
    const all = Array.from(document.querySelectorAll('video'));
    if (all.length === 0) return null;
    // Prefer on-screen videos, but fall back to any element that has actually
    // loaded media: some players (e.g. video.js when it is not in "fluid" mode)
    // briefly report a 0x0 box for the real <video>, which the strict size
    // filter alone would drop, leaving the shortcut with nothing to act on.
    let pool = all.filter((v) => v.clientWidth > 0 && v.clientHeight > 0);
    if (pool.length === 0) pool = all.filter((v) => v.readyState > 0 || v.currentSrc);
    if (pool.length === 0) return null;
    const playing = pool.filter((v) => !v.paused && !v.ended);
    if (playing.length > 0) pool = playing;
    return pool.reduce((largest, v) => {
      const area = v.clientWidth * v.clientHeight;
      const largestArea = largest.clientWidth * largest.clientHeight;
      return area > largestArea ? v : largest;
    }, pool[0]);
  }

  function showToast(video, text) {
    let toast = video._speedToast;
    if (!toast || !toast.isConnected) {
      toast = document.createElement('div');
      toast.style.cssText = [
        'position:absolute',
        'top:12px',
        'left:12px',
        'z-index:2147483647',
        'padding:4px 10px',
        'border-radius:4px',
        'background:rgba(0,0,0,0.75)',
        'color:#fff',
        'font-family:sans-serif',
        'font-size:14px',
        'pointer-events:none',
        'transition:opacity 0.2s',
      ].join(';');
      const container = video.parentElement || document.body;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }
      container.appendChild(toast);
      video._speedToast = toast;
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(video._speedToastTimer);
    video._speedToastTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, 800);
  }

  function applyDelta(delta) {
    const video = getActiveVideo();
    if (!video) return;
    const newRate = Math.min(MAX_RATE, Math.max(MIN_RATE, video.playbackRate + delta));
    video.playbackRate = newRate;
    userDesiredRate = newRate;
    showToast(video, `${newRate.toFixed(2)}x`);
  }

  function applySeek(delta, video) {
    video = video || getActiveVideo();
    if (!video) return;
    const duration = video.duration;
    let next = video.currentTime + delta;
    next = Math.max(0, Number.isFinite(duration) ? Math.min(duration, next) : next);
    video.currentTime = next;
    showToast(video, `${delta > 0 ? '+' : ''}${delta}s`);
  }

  // Arrow keys we've consumed on keydown and must also swallow on the matching
  // keyup, since some players (video.js's bundled hotkeys, and this or that
  // site's own handler) do their seeking on keyUP - without this our jump gets
  // stacked on top of theirs and the video lands in the wrong place.
  const consumedKeys = new Set();

  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

      const isSpeedKey = event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown');
      const isSeekKey =
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
      if (!isSpeedKey && !isSeekKey) return;

      if (isSpeedKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const delta = event.key === 'ArrowUp' ? STEP : -STEP;
        // The actual playing <video> may live in a different frame than the one
        // that has keyboard focus (e.g. a cross-origin iframe embed, which never
        // gets focus on autoplay) - relay through the background page so every
        // frame in the tab gets a chance to find and adjust its own video.
        chrome.runtime.sendMessage({ type: 'speed-broadcast', delta });
        return;
      }

      // Seek: only take over Left/Right when THIS frame actually has a video to
      // act on. That keeps the plain arrow keys untouched on pages that use them
      // for scrolling, carousels or slideshows, and lets a cross-origin embed
      // still work once it's been clicked (its own copy of this script, running
      // inside that iframe, then owns the keydown). stopImmediatePropagation +
      // the keyup swallow below mean sites that already seek on arrows - YouTube,
      // video.js, etc. - are fully pre-empted, so the jump stays one SEEK_STEP.
      const video = getActiveVideo();
      if (!video) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      consumedKeys.add(event.key);
      applySeek(event.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP, video);
    },
    true
  );

  document.addEventListener(
    'keyup',
    (event) => {
      if (!consumedKeys.has(event.key)) return;
      consumedKeys.delete(event.key);
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'speed-apply') applyDelta(message.delta);
  });

  if (location.hostname.endsWith('youtube.com')) {
    const WALL_RECOVERY_GRACE_MS = 3000;
    let adWasShowing = false;
    let savedMuted = false;
    let wallRemovedAt = 0;
    let reloadedForWall = false;

    // The "ad blocker detected" wall is a separate ytd-enforcement-message-view-model
    // dialog (not a skippable ad) that YouTube injects and uses to pause the player.
    // It has no dismiss button in its current form, so the only way past it is to
    // tear the dialog + its backdrop out of the DOM and resume playback ourselves.
    function removeAdblockWall() {
      const message = document.querySelector('ytd-enforcement-message-view-model');
      if (!message) return false;
      const dialog = message.closest('tp-yt-paper-dialog') || message;
      dialog.remove();
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((el) => el.remove());
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      return true;
    }

    setInterval(() => {
      const player = document.getElementById('movie_player');
      if (!player) return;
      const video = player.querySelector('video');
      if (!video) return;

      if (removeAdblockWall()) {
        if (!wallRemovedAt) wallRemovedAt = Date.now();
        if (video.paused) video.play().catch(() => {});
      }

      // By the time the wall is on screen YouTube has often already torn down the
      // player's MediaSource, so removing the dialog leaves a permanently black
      // frame that play() can never revive. Reloading rebuilds the player; guard
      // it so a wall that keeps reappearing can't put us in a reload loop.
      if (wallRemovedAt && !reloadedForWall) {
        if (video.readyState > 0 && !video.error) {
          wallRemovedAt = 0;
        } else if (Date.now() - wallRemovedAt > WALL_RECOVERY_GRACE_MS) {
          reloadedForWall = true;
          location.reload();
          return;
        }
      }

      const adShowing =
        player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');

      if (adShowing) {
        if (!adWasShowing) savedMuted = video.muted;
        video.muted = true;
        // Seeking the ad to its end is what actually dismisses it. It needs no
        // trusted click (so no chrome.debugger, and no "started debugging this
        // browser" infobar reflowing the page out from under us), and it works
        // on non-skippable ads too, which a Skip button click never could.
        if (Number.isFinite(video.duration) && video.duration > 0) {
          if (video.currentTime < video.duration - 0.15) video.currentTime = video.duration;
          if (video.paused) video.play().catch(() => {});
        }
      } else if (adWasShowing) {
        video.muted = savedMuted;
        // The ad and the feature share one <video>, and YouTube resets its rate
        // when it swaps the source back, so re-apply what the user asked for.
        video.playbackRate = userDesiredRate;
      }
      adWasShowing = adShowing;
    }, 300);
  }
})();
