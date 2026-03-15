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
exports.buttonVariants = exports.Button = void 0;
var React = require("react");
var class_variance_authority_1 = require("class-variance-authority");
var radix_ui_1 = require("radix-ui");
var spinner_1 = require("./spinner");
var utils_1 = require("./utils");
var buttonVariants = (0, class_variance_authority_1.cva)("focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", {
    variants: {
        variant: {
            default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs",
            destructive: "bg-destructive hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 text-white shadow-xs",
            outline: "bg-background hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 border shadow-xs",
            secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-xs",
            ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
            link: "text-primary underline-offset-4 hover:underline",
        },
        size: {
            default: "h-9 px-4 py-2 has-[>svg]:px-3",
            sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
            lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
            icon: "size-9",
        },
        loading: {
            true: "disabled:opacity-100",
        },
    },
    compoundVariants: [
        {
            variant: "default",
            loading: true,
            className: "[&>:first-child]:bg-primary",
        },
        {
            variant: "destructive",
            loading: true,
            className: "[&>:first-child]:bg-destructive",
        },
        {
            variant: "outline",
            loading: true,
            className: "[&>:first-child]:bg-background",
        },
        {
            variant: "secondary",
            loading: true,
            className: "[&>:first-child]:bg-secondary",
        },
    ],
    defaultVariants: {
        variant: "default",
        size: "default",
    },
});
exports.buttonVariants = buttonVariants;
var Button = function (_a) {
    var className = _a.className, variant = _a.variant, size = _a.size, _b = _a.asChild, asChild = _b === void 0 ? false : _b, children = _a.children, disabled = _a.disabled, loading = _a.loading, props = __rest(_a, ["className", "variant", "size", "asChild", "children", "disabled", "loading"]);
    var Comp = asChild ? radix_ui_1.Slot.Root : "button";
    return (<Comp data-slot="button" className={(0, utils_1.cn)(buttonVariants({ variant: variant, size: size, loading: loading, className: className }))} disabled={loading !== null && loading !== void 0 ? loading : disabled} {...props}>
      {loading && (<span className="pointer-events-none absolute inset-0 grid place-items-center rounded-md">
          <spinner_1.Spinner className="size-4"/>
        </span>)}
      <radix_ui_1.Slot.Slottable>{children}</radix_ui_1.Slot.Slottable>
    </Comp>);
};
exports.Button = Button;
