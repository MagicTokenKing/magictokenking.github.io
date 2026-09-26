var posts=["2026/02/06/frowny-cloud/","2025/10/25/bastille-day/","2025/11/11/hallelujah/","2026/02/24/woomph/","2025/10/23/four-seven/","2025/09/17/buffalo-bill/","2026/03/24/ios-warfare/","2025/11/08/long-live-the-king/","2026/03/07/this-is-fine/","2025/11/28/snow-forecast/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };