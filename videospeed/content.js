(function () {
  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;
  let userDesiredRate = 1;

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video')).filter(
      (v) => v.clientWidth > 0 && v.clientHeight > 0
    );
    if (videos.length === 0) return null;
    const playing = videos.filter((v) => !v.paused && !v.ended);
    const pool = playing.length > 0 ? playing : videos;
    return pool.reduce((largest, v) => {
      const area = v.clientWidth * v.clientHeight;
      const largestArea = largest.clientWidth * largest.clientHeight;
      return area > largestArea ? v : largest;
    }, pool[0]);
  }

  function showToast(video, rate) {
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
    toast.textContent = `${rate.toFixed(2)}x`;
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
    showToast(video, newRate);
  }

  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

      event.preventDefault();
      event.stopPropagation();

      const delta = event.key === 'ArrowUp' ? STEP : -STEP;
      // The actual playing <video> may live in a different frame than the one
      // that has keyboard focus (e.g. a cross-origin iframe embed, which never
      // gets focus on autoplay) - relay through the background page so every
      // frame in the tab gets a chance to find and adjust its own video.
      chrome.runtime.sendMessage({ type: 'speed-broadcast', delta });
    },
    true
  );

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'speed-apply') applyDelta(message.delta);
  });

  if (location.hostname.endsWith('youtube.com')) {
    const SKIP_BUTTON_SELECTOR =
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button';
    let adWasShowing = false;
    let savedMuted = false;
    let lastSkipAttempt = 0;
    const SKIP_RETRY_COOLDOWN_MS = 700;

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

      if (removeAdblockWall() && video.paused) {
        video.play().catch(() => {});
      }

      const skipButton = player.querySelector(SKIP_BUTTON_SELECTOR);
      if (skipButton && parseFloat(getComputedStyle(skipButton).opacity) > 0.9) {
        const now = Date.now();
        if (now - lastSkipAttempt > SKIP_RETRY_COOLDOWN_MS) {
          lastSkipAttempt = now;
          const rect = skipButton.getBoundingClientRect();
          chrome.runtime.sendMessage({
            type: 'yt-skip-click',
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
        }
      }

      const adShowing =
        player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
      if (adShowing && !adWasShowing) {
        savedMuted = video.muted;
        video.muted = true;
        video.playbackRate = MAX_RATE;
      } else if (!adShowing && adWasShowing) {
        video.muted = savedMuted;
        video.playbackRate = userDesiredRate;
      }
      adWasShowing = adShowing;
    }, 300);
  }
})();
