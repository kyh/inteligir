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
exports.FieldTitle = exports.FieldContent = exports.FieldSet = exports.FieldSeparator = exports.FieldLegend = exports.FieldGroup = exports.FieldError = exports.FieldDescription = exports.FieldLabel = exports.Field = void 0;
var react_1 = require("react");
var class_variance_authority_1 = require("class-variance-authority");
var label_1 = require("./label");
var separator_1 = require("./separator");
var utils_1 = require("./utils");
var fieldVariants = (0, class_variance_authority_1.cva)("group/field data-[invalid=true]:text-destructive flex w-full gap-3", {
    variants: {
        orientation: {
            vertical: ["flex-col [&>*]:w-full [&>.sr-only]:w-auto"],
            horizontal: [
                "flex-row items-center",
                "[&>[data-slot=field-label]]:flex-auto",
                "has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px has-[>[data-slot=field-content]]:items-start",
            ],
            responsive: [
                "@md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto flex-col [&>*]:w-full [&>.sr-only]:w-auto",
                "@md/field-group:[&>[data-slot=field-label]]:flex-auto",
                "@md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
            ],
        },
    },
    defaultVariants: {
        orientation: "vertical",
    },
});
var FieldSet = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<fieldset data-slot="field-set" className={(0, utils_1.cn)("flex flex-col gap-6", "has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3", className)} {...props}/>);
};
exports.FieldSet = FieldSet;
var FieldLegend = function (_a) {
    var className = _a.className, _b = _a.variant, variant = _b === void 0 ? "legend" : _b, props = __rest(_a, ["className", "variant"]);
    return (<legend data-slot="field-legend" data-variant={variant} className={(0, utils_1.cn)("mb-3 font-medium", "data-[variant=legend]:text-base", "data-[variant=label]:text-sm", className)} {...props}/>);
};
exports.FieldLegend = FieldLegend;
var FieldGroup = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="field-group" className={(0, utils_1.cn)("group/field-group @container/field-group flex w-full flex-col gap-7 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4", className)} {...props}/>);
};
exports.FieldGroup = FieldGroup;
var Field = function (_a) {
    var className = _a.className, _b = _a.orientation, orientation = _b === void 0 ? "vertical" : _b, props = __rest(_a, ["className", "orientation"]);
    return (<div role="group" data-slot="field" data-orientation={orientation} className={(0, utils_1.cn)(fieldVariants({ orientation: orientation }), className)} {...props}/>);
};
exports.Field = Field;
var FieldContent = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="field-content" className={(0, utils_1.cn)("group/field-content flex flex-1 flex-col gap-1.5 leading-snug", className)} {...props}/>);
};
exports.FieldContent = FieldContent;
var FieldLabel = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<label_1.Label data-slot="field-label" className={(0, utils_1.cn)("group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50", "has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col has-[>[data-slot=field]]:rounded-md has-[>[data-slot=field]]:border [&>[data-slot=field]]:p-4", "has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:border-primary dark:has-data-[state=checked]:bg-primary/10", className)} {...props}/>);
};
exports.FieldLabel = FieldLabel;
var FieldTitle = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="field-label" className={(0, utils_1.cn)("flex w-fit items-center gap-2 text-sm font-medium leading-snug group-data-[disabled=true]/field:opacity-50", className)} {...props}/>);
};
exports.FieldTitle = FieldTitle;
var FieldDescription = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<p data-slot="field-description" className={(0, utils_1.cn)("text-muted-foreground text-sm font-normal leading-normal group-has-[[data-orientation=horizontal]]/field:text-balance", "nth-last-2:-mt-1 last:mt-0 [[data-variant=legend]+&]:-mt-1.5", "[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4", className)} {...props}/>);
};
exports.FieldDescription = FieldDescription;
var FieldSeparator = function (_a) {
    var children = _a.children, className = _a.className, props = __rest(_a, ["children", "className"]);
    return (<div data-slot="field-separator" data-content={!!children} className={(0, utils_1.cn)("relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2", className)} {...props}>
      <separator_1.Separator className="absolute inset-0 top-1/2"/>
      {children && (<span className="bg-background text-muted-foreground relative mx-auto block w-fit px-2" data-slot="field-separator-content">
          {children}
        </span>)}
    </div>);
};
exports.FieldSeparator = FieldSeparator;
var FieldError = function (_a) {
    var className = _a.className, children = _a.children, maybeErrors = _a.errors, props = __rest(_a, ["className", "children", "errors"]);
    var content = (0, react_1.useMemo)(function () {
        var _a;
        if (children) {
            return children;
        }
        var errors = (maybeErrors !== null && maybeErrors !== void 0 ? maybeErrors : []).filter(function (error) { return error !== undefined; });
        if (errors.length === 0) {
            return null;
        }
        if (errors.length === 1 && ((_a = errors[0]) === null || _a === void 0 ? void 0 : _a.message)) {
            return errors[0].message;
        }
        return (<ul className="ml-4 flex list-disc flex-col gap-1">
        {errors.map(function (error, index) { return (error === null || error === void 0 ? void 0 : error.message) && <li key={index}>{error.message}</li>; })}
      </ul>);
    }, [children, maybeErrors]);
    if (!content) {
        return null;
    }
    return (<div role="alert" data-slot="field-error" className={(0, utils_1.cn)("text-destructive text-sm font-normal", className)} {...props}>
      {content}
    </div>);
};
exports.FieldError = FieldError;
