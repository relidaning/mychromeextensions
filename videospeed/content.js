(function () {
  const STEP = 0.25;
  const MIN_RATE = 0.25;
  const MAX_RATE = 4;

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
      if (!event.ctrlKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;

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
      showToast(video, newRate);
    },
    true
  );
})();
