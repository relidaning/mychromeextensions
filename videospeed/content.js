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
    // Once the user pauses, nothing is "playing" any more. Stick with the video
    // we last controlled so a resume doesn't land on some other (e.g. hidden feed)
    // <video> that the site immediately pauses again.
    else if (lastVideo && pool.includes(lastVideo)) return lastVideo;
    return pool.reduce((best, v) => (visibleArea(v) > visibleArea(best) ? v : best), pool[0]);
  }

  let lastVideo = null;

  // Area of the video actually inside the viewport, so off-screen / scrolled-away
  // videos lose to the one the user is looking at.
  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
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
    lastVideo = video;
    const duration = video.duration;
    let next = video.currentTime + delta;
    next = Math.max(0, Number.isFinite(duration) ? Math.min(duration, next) : next);
    video.currentTime = next;
    showToast(video, `${delta > 0 ? '+' : ''}${delta}s`);
  }

  function togglePlay(video) {
    lastVideo = video;
    const willPlay = video.paused;
    if (willPlay) video.play().catch(() => {});
    else video.pause();
    showToast(video, willPlay ? '▶' : '⏸');
  }

  function runAction(action, video) {
    if (action === 'toggle') togglePlay(video);
    else applySeek(action === 'forward' ? SEEK_STEP : -SEEK_STEP, video);
  }

  // Keys we've consumed on keydown and must also swallow on the matching keyup,
  // since some players (video.js's bundled hotkeys, and this or that site's own
  // handler) act on keyUP - Space toggles play there, arrows seek there. Without
  // swallowing the keyup our action gets undone (Space) or stacked on (arrows).
  const consumedKeys = new Set();

  // Listen on window, not document: window's capture phase runs before
  // document's, so we pre-empt site handlers that would otherwise toggle the
  // video a second time (the "starts then pauses immediately" symptom).
  window.addEventListener(
    'keydown',
    (event) => {
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

      const noMods = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      const isSpeedKey = event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown');
      const isSeekKey = noMods && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
      const isPlayPauseKey = noMods && (event.key === ' ' || event.code === 'Space');
      if (!isSpeedKey && !isSeekKey && !isPlayPauseKey) return;

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

      // Space would otherwise activate a focused button / link / select - leave
      // those alone.
      if (isPlayPauseKey && (tag === 'BUTTON' || tag === 'SELECT' || tag === 'A')) return;

      // Seek and play/pause only take over when THIS frame actually has a video
      // to act on. That keeps the keys untouched on pages that use them for
      // scrolling / carousels / slideshows, and lets a cross-origin embed still
      // work once it's been clicked (its own copy of this script, running inside
      // that iframe, then owns the keydown). stopImmediatePropagation + the keyup
      // swallow below fully pre-empt players that already handle these keys
      // (YouTube, video.js, ...) so a press does exactly one thing.
      const action = isPlayPauseKey ? 'toggle' : event.key === 'ArrowRight' ? 'forward' : 'back';
      const video = getActiveVideo();
      if (!video) {
        // Keyboard focus is often on the top frame while the real <video> sits in
        // an iframe that was never clicked, so hand the key to the other frames.
        // Only take the key away from the page if an iframe could plausibly own
        // the video, otherwise Space / arrows keep scrolling normally.
        if (!event.repeat && window === window.top && document.querySelector('iframe')) {
          event.preventDefault();
          chrome.runtime.sendMessage({ type: 'key-broadcast', action });
        } else if (window !== window.top && !event.repeat) {
          chrome.runtime.sendMessage({ type: 'key-broadcast', action });
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      consumedKeys.add(event.key);
      if (event.repeat) return;
      runAction(action, video);
    },
    true
  );

  window.addEventListener(
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
    else if (message.type === 'key-apply') {
      const video = getActiveVideo();
      if (video) runAction(message.action, video);
    }
  });

  // Douyin's player cancels every keydown while a video is open, whatever
  // modifiers are held, and runs its single-letter hotkeys even with Alt/Ctrl
  // down (Alt+C favourites the video). That kills every browser shortcut a page
  // is allowed to cancel: Alt+1..9, Alt+Left, Ctrl+F, Ctrl+L, F5, F12, ...
  // Hide modifier combos and function keys from the page so Chrome handles
  // them; plain keys still reach Douyin's own hotkeys.
  if (location.hostname.endsWith('douyin.com')) {
    const hideFromPage = (event) => {
      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
      const isFunctionKey = /^F\d{1,2}$/.test(event.key);
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !isFunctionKey) return;
      event.stopImmediatePropagation();
    };
    for (const type of ['keydown', 'keypress', 'keyup']) {
      window.addEventListener(type, hideFromPage, true);
    }
  }

  if (location.hostname.endsWith('youtube.com')) {
    const WALL_RECOVERY_GRACE_MS = 3000;
    let adWasShowing = false;
    let savedMuted = false;
    let wallRemovedAt = 0;
    let reloadedForWall = false;
    const AD_RATE = 16;
    let skippedThisAd = false;

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
        // Fast-forward the ad instead of seeking to its end. A seek to the end makes
        // the ad look skipped/tampered with, and YouTube answers by serving ads far
        // more often (about every minute). Playing it through at 16x is the
        // closest thing to a normal view that still takes only a second or two,
        // needs no trusted click (no chrome.debugger infobar), and also works on
        // unskippable ads.
        if (video.playbackRate !== AD_RATE) video.playbackRate = AD_RATE;
        if (video.paused) video.play().catch(() => {});
        // A skippable ad whose Skip button is up: do what a person pressing it does.
        // (Synthetic clicks are often ignored, so also jump to the end, but only
        // once the button is offered, which looks like a normal skip, not tampering.)
        const skip = player.querySelector(
          '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern'
        );
        if (skip && skip.offsetParent !== null && !skippedThisAd) {
          skippedThisAd = true;
          skip.click();
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        }
      } else if (adWasShowing) {
        skippedThisAd = false;
        video.muted = savedMuted;
        // The ad and the feature share one <video>, and YouTube resets its rate
        // when it swaps the source back, so re-apply what the user asked for.
        video.playbackRate = userDesiredRate;
      }
      adWasShowing = adShowing;
    }, 150);
  }
})();
