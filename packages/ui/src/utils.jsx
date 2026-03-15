"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cn = void 0;
exports.composeRefs = composeRefs;
exports.useComposedRefs = useComposedRefs;
exports.useCallbackRef = useCallbackRef;
exports.useDebounce = useDebounce;
exports.useDebouncedCallback = useDebouncedCallback;
exports.useMediaQuery = useMediaQuery;
exports.formatDate = formatDate;
var React = require("react");
var class_variance_authority_1 = require("class-variance-authority");
var tailwind_merge_1 = require("tailwind-merge");
var cn = function () {
    var inputs = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        inputs[_i] = arguments[_i];
    }
    return (0, tailwind_merge_1.twMerge)((0, class_variance_authority_1.cx)(inputs));
};
exports.cn = cn;
/**
 * Set a given ref to a given value
 * This utility takes care of different types of refs: callback refs and RefObject(s)
 */
function setRef(ref, value) {
    if (typeof ref === "function") {
        ref(value);
    }
    else if (ref !== null && ref !== undefined) {
        ref.current = value;
    }
}
/**
 * A utility to compose multiple refs together
 * Accepts callback refs and RefObject(s)
 */
function composeRefs() {
    var refs = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        refs[_i] = arguments[_i];
    }
    return function (node) { return refs.forEach(function (ref) { return setRef(ref, node); }); };
}
/**
 * A custom hook that composes multiple refs
 * Accepts callback refs and RefObject(s)
 */
function useComposedRefs() {
    var refs = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        refs[_i] = arguments[_i];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return React.useCallback(composeRefs.apply(void 0, refs), refs);
}
/**
 * @see https://github.com/radix-ui/primitives/blob/main/packages/react/use-callback-ref/src/useCallbackRef.tsx
 */
/**
 * A custom hook that converts a callback to a ref to avoid triggering re-renders when passed as a
 * prop or avoid re-executing effects when passed as a dependency
 */
function useCallbackRef(callback) {
    var callbackRef = React.useRef(callback);
    React.useEffect(function () {
        callbackRef.current = callback;
    });
    // https://github.com/facebook/react/issues/19240
    return React.useMemo(function () { return (function () {
        var _a;
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        return (_a = callbackRef.current) === null || _a === void 0 ? void 0 : _a.call.apply(_a, __spreadArray([callbackRef], args, false));
    }); }, []);
}
function useDebounce(value, delay) {
    var _a = React.useState(value), debouncedValue = _a[0], setDebouncedValue = _a[1];
    React.useEffect(function () {
        var timer = setTimeout(function () { return setDebouncedValue(value); }, delay !== null && delay !== void 0 ? delay : 500);
        return function () {
            clearTimeout(timer);
        };
    }, [value, delay]);
    return debouncedValue;
}
function useDebouncedCallback(callback, delay) {
    var handleCallback = useCallbackRef(callback);
    var debounceTimerRef = React.useRef(0);
    React.useEffect(function () { return function () { return window.clearTimeout(debounceTimerRef.current); }; }, []);
    var setValue = React.useCallback(function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = window.setTimeout(function () { return handleCallback.apply(void 0, args); }, delay);
    }, [handleCallback, delay]);
    return setValue;
}
function useMediaQuery(query) {
    if (query === void 0) { query = "(min-width: 640px)"; }
    var _a = React.useState(false), value = _a[0], setValue = _a[1];
    React.useEffect(function () {
        function onChange(event) {
            setValue(event.matches);
        }
        var result = matchMedia(query);
        result.addEventListener("change", onChange);
        setValue(result.matches);
        return function () { return result.removeEventListener("change", onChange); };
    }, [query]);
    return value;
}
function formatDate(date, opts) {
    var _a, _b, _c;
    if (opts === void 0) { opts = {}; }
    return new Intl.DateTimeFormat("en-US", __assign({ month: (_a = opts.month) !== null && _a !== void 0 ? _a : "long", day: (_b = opts.day) !== null && _b !== void 0 ? _b : "numeric", year: (_c = opts.year) !== null && _c !== void 0 ? _c : "numeric" }, opts)).format(new Date(date));
}
