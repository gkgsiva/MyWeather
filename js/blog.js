// Lists the latest Kea Weather Blog posts. kwschennai.com/blog is a WordPress site,
// whose REST API allows cross-site reads; if that fails, the "Open the blog"
// button still works.
const BLOG = "https://kwschennai.com";
const API = `${BLOG}/blog/wp-json/wp/v2/posts?per_page=15&_fields=link,title,date,excerpt`;

import { routeParams } from "./route.js";

const list = document.getElementById("blog-posts");
const home = document.getElementById("blog-home");
const reader = document.getElementById("blog-reader");
const frame = document.getElementById("blog-frame");
const status = document.getElementById("blog-status");

// Titles and excerpts come as HTML; keep only their text.
function text(html) {
  return new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();
}

// Posts open in a frame under the menu: #blog?post=<url>.
const postRoute = (url) => `#blog?post=${encodeURIComponent(url)}`;
const isBlogUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "kwschennai.com" || u.hostname.endsWith(".kwschennai.com"));
  } catch {
    return false;
  }
};

let loaded = false;

export function showBlog() {
  const post = routeParams().get("post");
  if (post && isBlogUrl(post)) {
    home.hidden = true;
    reader.hidden = false;
    if (frame.dataset.src !== post) {
      frame.dataset.src = post;
      frame.src = post;
    }
    return;
  }
  reader.hidden = true;
  home.hidden = false;
  if (!loaded) {
    loaded = true;
    loadPosts();
  }
}

async function loadPosts() {
  status.textContent = "Loading latest posts…";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(API, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = await res.json();
    if (!Array.isArray(posts) || !posts.length) throw new Error("no posts");

    list.replaceChildren(
      ...posts.map((p) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = postRoute(p.link);
        a.textContent = text(p.title?.rendered) || p.link;
        const meta = document.createElement("small");
        meta.textContent = new Date(p.date).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const excerpt = document.createElement("p");
        excerpt.textContent = text(p.excerpt?.rendered).slice(0, 220);
        li.append(a, meta, excerpt);
        return li;
      })
    );
    status.textContent = "";
  } catch {
    status.textContent = "Couldn't load the post list here. Use “Open the blog” above.";
    loaded = false; // try again next time
  }
}
