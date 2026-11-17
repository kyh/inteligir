// The device's preferences blob, which prefs.ts persists, and the script the document runs in its
// <head> before the first paint over the theme `persist` writes there; a theme it cannot read
// follows the system's. Apart from prefs.ts, which builds stores, so the root layout's server render
// reaches neither the stores nor the theme's context.
export const DEVICE_PREFS = "inteligir.prefs";

export const noFlashThemeScript = `(function(){var t;try{t=JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_PREFS)})).state.theme}catch(e){}document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))})();`;
