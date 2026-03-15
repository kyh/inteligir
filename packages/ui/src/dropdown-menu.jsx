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
exports.DropdownMenuSubContent = exports.DropdownMenuSubTrigger = exports.DropdownMenuSub = exports.DropdownMenuShortcut = exports.DropdownMenuSeparator = exports.DropdownMenuRadioItem = exports.DropdownMenuRadioGroup = exports.DropdownMenuCheckboxItem = exports.DropdownMenuItem = exports.DropdownMenuLabel = exports.DropdownMenuGroup = exports.DropdownMenuContent = exports.DropdownMenuTrigger = exports.DropdownMenuPortal = exports.DropdownMenu = void 0;
var React = require("react");
var lucide_react_1 = require("lucide-react");
var radix_ui_1 = require("radix-ui");
var utils_1 = require("./utils");
var DropdownMenu = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.DropdownMenu.Root data-slot="dropdown-menu" {...props}/>;
};
exports.DropdownMenu = DropdownMenu;
var DropdownMenuPortal = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.DropdownMenu.Portal data-slot="dropdown-menu-portal" {...props}/>;
};
exports.DropdownMenuPortal = DropdownMenuPortal;
var DropdownMenuTrigger = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.DropdownMenu.Trigger data-slot="dropdown-menu-trigger" {...props}/>;
};
exports.DropdownMenuTrigger = DropdownMenuTrigger;
var DropdownMenuContent = function (_a) {
    var className = _a.className, _b = _a.sideOffset, sideOffset = _b === void 0 ? 4 : _b, props = __rest(_a, ["className", "sideOffset"]);
    return (<radix_ui_1.DropdownMenu.Portal>
      <radix_ui_1.DropdownMenu.Content data-slot="dropdown-menu-content" sideOffset={sideOffset} className={(0, utils_1.cn)("bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md", className)} {...props}/>
    </radix_ui_1.DropdownMenu.Portal>);
};
exports.DropdownMenuContent = DropdownMenuContent;
var DropdownMenuGroup = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.DropdownMenu.Group data-slot="dropdown-menu-group" {...props}/>;
};
exports.DropdownMenuGroup = DropdownMenuGroup;
var DropdownMenuItem = function (_a) {
    var className = _a.className, inset = _a.inset, _b = _a.variant, variant = _b === void 0 ? "default" : _b, props = __rest(_a, ["className", "inset", "variant"]);
    return (<radix_ui_1.DropdownMenu.Item data-slot="dropdown-menu-item" data-inset={inset} data-variant={variant} className={(0, utils_1.cn)("focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)} {...props}/>);
};
exports.DropdownMenuItem = DropdownMenuItem;
var DropdownMenuCheckboxItem = function (_a) {
    var className = _a.className, children = _a.children, checked = _a.checked, props = __rest(_a, ["className", "children", "checked"]);
    return (<radix_ui_1.DropdownMenu.CheckboxItem data-slot="dropdown-menu-checkbox-item" className={(0, utils_1.cn)("focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)} checked={checked} {...props}>
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <radix_ui_1.DropdownMenu.ItemIndicator>
          <lucide_react_1.CheckIcon className="size-4"/>
        </radix_ui_1.DropdownMenu.ItemIndicator>
      </span>
      {children}
    </radix_ui_1.DropdownMenu.CheckboxItem>);
};
exports.DropdownMenuCheckboxItem = DropdownMenuCheckboxItem;
var DropdownMenuRadioGroup = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.DropdownMenu.RadioGroup data-slot="dropdown-menu-radio-group" {...props}/>;
};
exports.DropdownMenuRadioGroup = DropdownMenuRadioGroup;
var DropdownMenuRadioItem = function (_a) {
    var className = _a.className, children = _a.children, props = __rest(_a, ["className", "children"]);
    return (<radix_ui_1.DropdownMenu.RadioItem data-slot="dropdown-menu-radio-item" className={(0, utils_1.cn)("focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)} {...props}>
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <radix_ui_1.DropdownMenu.ItemIndicator>
          <lucide_react_1.CircleIcon className="size-2 fill-current"/>
        </radix_ui_1.DropdownMenu.ItemIndicator>
      </span>
      {children}
    </radix_ui_1.DropdownMenu.RadioItem>);
};
exports.DropdownMenuRadioItem = DropdownMenuRadioItem;
var DropdownMenuLabel = function (_a) {
    var className = _a.className, inset = _a.inset, props = __rest(_a, ["className", "inset"]);
    return (<radix_ui_1.DropdownMenu.Label data-slot="dropdown-menu-label" data-inset={inset} className={(0, utils_1.cn)("px-2 py-1.5 text-sm font-medium data-[inset]:pl-8", className)} {...props}/>);
};
exports.DropdownMenuLabel = DropdownMenuLabel;
var DropdownMenuSeparator = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.DropdownMenu.Separator data-slot="dropdown-menu-separator" className={(0, utils_1.cn)("bg-border -mx-1 my-1 h-px", className)} {...props}/>);
};
exports.DropdownMenuSeparator = DropdownMenuSeparator;
var DropdownMenuShortcut = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<span data-slot="dropdown-menu-shortcut" className={(0, utils_1.cn)("text-muted-foreground ml-auto text-xs tracking-widest", className)} {...props}/>);
};
exports.DropdownMenuShortcut = DropdownMenuShortcut;
var DropdownMenuSub = function (_a) {
    var props = __rest(_a, []);
    return <radix_ui_1.DropdownMenu.Sub data-slot="dropdown-menu-sub" {...props}/>;
};
exports.DropdownMenuSub = DropdownMenuSub;
var DropdownMenuSubTrigger = function (_a) {
    var className = _a.className, inset = _a.inset, children = _a.children, props = __rest(_a, ["className", "inset", "children"]);
    return (<radix_ui_1.DropdownMenu.SubTrigger data-slot="dropdown-menu-sub-trigger" data-inset={inset} className={(0, utils_1.cn)("focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8", className)} {...props}>
      {children}
      <lucide_react_1.ChevronRightIcon className="ml-auto size-4"/>
    </radix_ui_1.DropdownMenu.SubTrigger>);
};
exports.DropdownMenuSubTrigger = DropdownMenuSubTrigger;
var DropdownMenuSubContent = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<radix_ui_1.DropdownMenu.SubContent data-slot="dropdown-menu-sub-content" className={(0, utils_1.cn)("bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg", className)} {...props}/>);
};
exports.DropdownMenuSubContent = DropdownMenuSubContent;
