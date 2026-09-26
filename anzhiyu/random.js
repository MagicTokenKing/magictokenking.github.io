var posts=["2026/05/07/交易为生/","2026/05/15/币安alp打新/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };