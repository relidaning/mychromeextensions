(function () {
  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;
  let userDesiredRate = 1;

  function getActiveVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
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

  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

      const target = event.target;
      const tag = target && target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

      const video = getActiveVideo();
      if (!video) return;

      event.preventDefault();
      event.stopPropagation();

      const delta = event.key === 'ArrowUp' ? STEP : -STEP;
      const newRate = Math.min(MAX_RATE, Math.max(MIN_RATE, video.playbackRate + delta));
      video.playbackRate = newRate;
      userDesiredRate = newRate;
      showToast(video, newRate);
    },
    true
  );

  if (location.hostname.endsWith('youtube.com')) {
    const SKIP_BUTTON_SELECTOR =
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button';
    let adWasShowing = false;
    let savedMuted = false;
    let lastSkipAttempt = 0;
    const SKIP_RETRY_COOLDOWN_MS = 700;

    setInterval(() => {
      const player = document.getElementById('movie_player');
      if (!player) return;
      const video = player.querySelector('video');
      if (!video) return;

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
