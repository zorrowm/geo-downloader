(function () {
  var layerIcon = [
    '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"',
    ' viewBox="0 0 24 24" aria-hidden="true">',
    '<path d="m4 7 8-4 8 4-8 4-8-4Z"/>',
    '<path d="m4 12 8 4 8-4M4 17l8 4 8-4"/>',
    '</svg>',
  ].join('');

  var downloadIcon = [
    '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"',
    ' viewBox="0 0 24 24" aria-hidden="true">',
    '<path stroke-linecap="round" stroke-linejoin="round"',
    ' d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>',
    '</svg>',
  ].join('');

  function currentAttribute(name, current) {
    return name === current ? ' aria-current="page"' : '';
  }

  class GeoDNav extends HTMLElement {
    connectedCallback() {
      var current = this.getAttribute('current') || '';
      this.innerHTML = [
        '<nav class="site-nav" aria-label="主导航"><div class="nav-inner">',
        '<a href="./" class="brand" aria-label="GeoD 首页">',
        '<span class="brand-mark">', layerIcon, '</span><span>GeoD</span></a>',
        '<div class="nav-links">',
        '<a href="./#features"', currentAttribute('home', current), '>能力</a>',
        '<a href="./#screenshots">界面</a>',
        '<a href="./history.html"', currentAttribute('history', current), '>历史版本</a>',
        '<a href="./disclaimer.html"', currentAttribute('disclaimer', current), '>免责声明</a>',
        '<a href="https://github.com/gaopengbin/geo-downloader" target="_blank" rel="noreferrer">GitHub</a>',
        '<a href="./#download" class="nav-download">', downloadIcon, '<span>下载 GeoD</span></a>',
        '</div></div></nav>',
      ].join('');
    }
  }

  class GeoDFooter extends HTMLElement {
    connectedCallback() {
      this.innerHTML = [
        '<footer class="site-footer"><div class="footer-inner">',
        '<div><div class="footer-brand">GeoD</div>',
        '<p>&copy; 2024-2026 · 免费开源 · MIT License</p></div>',
        '<div class="footer-links">',
        '<a href="./">首页</a>',
        '<a href="./history.html">历史版本</a>',
        '<a href="./disclaimer.html">免责声明</a>',
        '<a href="https://github.com/gaopengbin/geo-downloader/issues" target="_blank" rel="noreferrer">问题反馈</a>',
        '<a href="https://github.com/gaopengbin/geo-downloader" target="_blank" rel="noreferrer">GitHub</a>',
        '<span>微信 gpb230314</span>',
        '</div></div></footer>',
      ].join('');
    }
  }

  customElements.define('geod-nav', GeoDNav);
  customElements.define('geod-footer', GeoDFooter);
})();
