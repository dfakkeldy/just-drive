// Accept either shell as input when rebuilding an isolated or previously published folder.
export function normalizedPage(page,appUrl) {
 return page.replace(/\s+integrity="[^"]*"/g,'')
  .replace(/src="(?:(?:\/|\.\/)?app\.js|\/offline\/app\.[a-f0-9]+\.js)"/,`src="${appUrl}"`)
  .replace(/<(?:meta name="(?:mmm-build|mmm-page|mmm-offline-bytes|apple-mobile-web-app-[^"]+)"|link rel="(?:manifest|apple-touch-icon)")[^>]*>\n?/g,'');
}
