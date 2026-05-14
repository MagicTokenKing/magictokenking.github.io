var posts=["2026/05/07/hello-world/","2026/05/15/博客标题名/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };