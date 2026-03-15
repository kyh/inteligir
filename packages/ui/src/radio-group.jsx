"use client";
"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RadioGroupItem = exports.RadioGroup = void 0;
var React = require("react");
var lucide_react_1 = require("lucide-react");
var radix_ui_1 = require("radix-ui");
var utils_1 = require("./utils");
var RadioGroup = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.RadioGroup.Root data-slot="radio-group" className={(0, utils_1.cn)("grid gap-3", className)} {...props}/>);
};
exports.RadioGroup = RadioGroup;
var RadioGroupItem = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.RadioGroup.Item data-slot="radio-group-item" className={(0, utils_1.cn)("border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50", className)} {...props}>
      <radix_ui_1.RadioGroup.Indicator data-slot="radio-group-indicator" className="relative flex items-center justify-center">
        <lucide_react_1.CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2"/>
      </radix_ui_1.RadioGroup.Indicator>
    </radix_ui_1.RadioGroup.Item>);
};
exports.RadioGroupItem = RadioGroupItem;
