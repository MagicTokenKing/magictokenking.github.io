/* ============================================================
   首页瀑布流 + 无限滚动
   - 多列错落布局（≥1180px 三列，≥700px 两列，其余单列）
   - 滚动到底部自动抓取下一页 HTML 并追加，取代分页跳转
   - 无 JS / 抓取失败时退化为普通列表（分页按钮保留）
   ============================================================ */
(function () {
  "use strict";

  var GAP = 20;
  var COLS_2 = 700; // ≥700px 两列，其余单列（固定两列，不再出现三列）
  var PRELOAD = 900; // 提前加载距离（px）

  var container = null;
  var statusEl = null;
  var observer = null;
  var resizeTimer = null;

  var state = { next: null, loading: false, done: false, failed: false };

  /* ---------------- 工具 ---------------- */

  function isItem(node) {
    return (
      node &&
      node.nodeType === 1 &&
      node.classList &&
      node.classList.contains("recent-post-item")
    );
  }

  function getItems() {
    if (!container) return [];
    return Array.prototype.filter.call(container.children, isItem);
  }

  function getNextUrl(doc) {
    var a = doc.querySelector("#pagination a.extend.next");
    if (!a) return null;
    var href = a.getAttribute("href") || "";
    href = href.split("#")[0];
    if (!href || href.indexOf("javascript:") === 0) return null;
    return href;
  }

  function ensureStatus() {
    if (!container) return null;
    var s = document.getElementById("wf-status");
    if (!s || s.parentNode !== container) {
      s = document.createElement("div");
      s.id = "wf-status";
      s.className = "is-idle";
      s.innerHTML = '<span class="wf-dot"></span><span class="wf-text"></span>';
      container.appendChild(s);
    }
    statusEl = s;
    return s;
  }

  function setStatus(kind, text) {
    var s = ensureStatus();
    if (!s) return;
    var t = s.querySelector(".wf-text");
    s.className = "";
    if (kind === "loading") {
      s.classList.add("is-loading");
      if (t) t.textContent = "正在加载更多文章…";
    } else if (kind === "end") {
      s.classList.add("is-end");
      if (t) t.textContent = "已经看到全部文章了";
    } else if (kind === "error") {
      s.classList.add("is-error");
      if (t) {
        t.innerHTML =
          '加载失败，<span class="wf-retry">点此重试</span>';
      }
    } else {
      s.classList.add("is-idle");
      if (t) t.textContent = "";
    }
    s.onclick = kind === "error" ? retry : null;
  }

  /* ---------------- 布局 ---------------- */

  function layout() {
    if (!container || !container.classList.contains("wf-grid")) return;

    var items = getItems();
    var width = container.clientWidth;
    var cols = width >= COLS_2 ? 2 : 1;
    var bar = document.getElementById("categoryBar");
    if (bar && bar.parentNode !== container) bar = null;
    var s = ensureStatus();

    if (cols <= 1) {
      container.classList.add("wf-single");
      items.forEach(function (n) {
        n.style.position = "";
        n.style.left = "";
        n.style.top = "";
        n.style.width = "";
      });
      if (bar) {
        bar.style.position = "";
        bar.style.left = "";
        bar.style.top = "";
        bar.style.width = "";
      }
      container.style.height = "";
      if (s) s.style.top = "";
      return;
    }

    container.classList.remove("wf-single");

    var colW = Math.floor((width - GAP * (cols - 1)) / cols);
    var startY = 0;

    if (bar) {
      bar.style.position = "absolute";
      bar.style.top = "0";
      bar.style.left = "0";
      bar.style.width = "100%";
      startY = bar.offsetHeight + GAP;
    }

    var tops = [];
    for (var i = 0; i < cols; i++) tops.push(startY);

    // 第一遍：只写宽度
    for (var j = 0; j < items.length; j++) {
      items[j].style.position = "absolute";
      items[j].style.width = colW + "px";
    }

    // 第二遍：批量读取高度（只触发一次重排）
    var heights = [];
    for (var k = 0; k < items.length; k++) heights.push(items[k].offsetHeight);

    // 第三遍：放入当前最矮的一列
    for (var m = 0; m < items.length; m++) {
      var target = 0;
      for (var c = 1; c < cols; c++) {
        if (tops[c] < tops[target] - 0.5) target = c;
      }
      items[m].style.left = target * (colW + GAP) + "px";
      items[m].style.top = tops[target] + "px";
      tops[target] += heights[m] + GAP;
    }

    var contentBottom = Math.max.apply(null, tops) - GAP;
    if (!isFinite(contentBottom) || contentBottom < 0) contentBottom = 0;

    if (s) {
      var statusH = s.offsetHeight || 42;
      s.style.top = contentBottom + 8 + "px";
      container.style.height = contentBottom + 8 + statusH + 8 + "px";
    } else {
      container.style.height = contentBottom + "px";
    }
  }

  function debounceLayout() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  }

  /* ---------------- 加载更多 ---------------- */

  function nearViewport() {
    if (!statusEl) return false;
    var r = statusEl.getBoundingClientRect();
    return r.top < window.innerHeight + PRELOAD;
  }

  function retry() {
    state.failed = false;
    setStatus("loading");
    loadMore();
  }

  function loadMore() {
    if (!container || state.loading || state.done || !state.next) return;
    state.loading = true;
    state.failed = false;
    setStatus("loading");

    var url = state.next;

    fetch(url, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.text();
      })
      .then(function (html) {
        if (!container || !document.body.contains(container)) return;
        var doc = new DOMParser().parseFromString(html, "text/html");
        var host = doc.getElementById("recent-posts");
        if (!host) {
          state.done = true;
          return;
        }
        var nodes = Array.prototype.filter.call(host.children, isItem);
        if (!nodes.length) {
          state.done = true;
          return;
        }
        var frag = document.createDocumentFragment();
        nodes.forEach(function (n) {
          frag.appendChild(document.importNode(n, true));
        });
        container.appendChild(frag);

        state.next = getNextUrl(doc);
        if (!state.next) state.done = true;

        layout();
        if (window.lazyLoadInstance) window.lazyLoadInstance.update();
        if (window.panguInit) {
          try {
            window.panguInit();
          } catch (e) {
            /* 忽略 */
          }
        }
      })
      .catch(function () {
        state.failed = true;
        setStatus("error");
      })
      .then(function () {
        state.loading = false;
        if (state.done) {
          setStatus("end");
          layout();
          if (observer) observer.disconnect();
          return;
        }
        if (state.failed) return;
        setStatus("idle");
        layout();
        // 内容不够高时继续补一页
        setTimeout(function () {
          if (!state.loading && nearViewport()) loadMore();
        }, 250);
      });
  }

  function bindObserver() {
    if (observer) observer.disconnect();
    if (!statusEl || !("IntersectionObserver" in window)) {
      // 兜底：滚动监听
      window.removeEventListener("scroll", onScroll);
      window.addEventListener("scroll", onScroll, { passive: true });
      return;
    }
    observer = new IntersectionObserver(
      function (entries) {
        if (entries[0] && entries[0].isIntersecting) loadMore();
      },
      { rootMargin: PRELOAD + "px 0px" }
    );
    observer.observe(statusEl);
  }

  var scrollTick = false;
  function onScroll() {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(function () {
      scrollTick = false;
      if (nearViewport()) loadMore();
    });
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    var c = document.getElementById("recent-posts");
    if (!c) {
      container = null;
      statusEl = null;
      if (observer) observer.disconnect();
      observer = null;
      return;
    }
    if (c.dataset.wfReady === "1") return;

    container = c;
    container.dataset.wfReady = "1";
    container.classList.add("wf-grid");

    state.next = getNextUrl(document);
    state.loading = false;
    state.done = !state.next;
    state.failed = false;

    ensureStatus();
    if (state.done) {
      setStatus("end");
    } else {
      setStatus("idle");
    }

    layout();
    window.requestAnimationFrame(layout);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(layout).catch(function () {});
    }
    bindObserver();
  }

  window.addEventListener("resize", debounceLayout, { passive: true });

  // pjax 页面切换：清理并重新初始化
  document.addEventListener("pjax:send", function () {
    if (observer) observer.disconnect();
    observer = null;
    container = null;
    statusEl = null;
    state.loading = false;
  });

  document.addEventListener("pjax:complete", function () {
    window.setTimeout(init, 60);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
