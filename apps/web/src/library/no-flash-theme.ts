export const DEVICE_PREFS = "inteligir.prefs";

export const noFlashThemeScript = `(function(){var t;try{t=JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_PREFS)})).state.theme}catch(e){}document.documentElement.classList.toggle("dark",t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))})();`;
