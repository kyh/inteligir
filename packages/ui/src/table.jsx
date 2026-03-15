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
exports.AutoTable = exports.TableCaption = exports.TableCell = exports.TableRow = exports.TableHead = exports.TableFooter = exports.TableBody = exports.TableHeader = exports.Table = void 0;
var React = require("react");
var react_table_1 = require("@tanstack/react-table");
var utils_1 = require("./utils");
var Table = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={(0, utils_1.cn)("w-full caption-bottom text-sm", className)} {...props}/>
    </div>);
};
exports.Table = Table;
var TableHeader = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return <thead data-slot="table-header" className={(0, utils_1.cn)("[&_tr]:border-b", className)} {...props}/>;
};
exports.TableHeader = TableHeader;
var TableBody = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<tbody data-slot="table-body" className={(0, utils_1.cn)("[&_tr:last-child]:border-0", className)} {...props}/>);
};
exports.TableBody = TableBody;
var TableFooter = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<tfoot data-slot="table-footer" className={(0, utils_1.cn)("bg-muted/50 border-t font-medium [&>tr]:last:border-b-0", className)} {...props}/>);
};
exports.TableFooter = TableFooter;
var TableRow = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<tr data-slot="table-row" className={(0, utils_1.cn)("hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors", className)} {...props}/>);
};
exports.TableRow = TableRow;
var TableHead = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<th data-slot="table-head" className={(0, utils_1.cn)("text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)} {...props}/>);
};
exports.TableHead = TableHead;
var TableCell = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<td data-slot="table-cell" className={(0, utils_1.cn)("p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)} {...props}/>);
};
exports.TableCell = TableCell;
var TableCaption = function (_a) {
    var className = _a.className, props = __rest(_a, ["className"]);
    return (<caption data-slot="table-caption" className={(0, utils_1.cn)("text-muted-foreground mt-4 text-sm", className)} {...props}/>);
};
exports.TableCaption = TableCaption;
var AutoTable = function (_a) {
    var table = _a.table;
    var columns = table.getAllColumns();
    return (<Table>
      <TableHeader>
        {table.getHeaderGroups().map(function (headerGroup) { return (<TableRow key={headerGroup.id}>
            {headerGroup.headers.map(function (header) {
                return (<TableHead key={header.id}>
                  {header.isPlaceholder
                        ? null
                        : (0, react_table_1.flexRender)(header.column.columnDef.header, header.getContext())}
                </TableHead>);
            })}
          </TableRow>); })}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length ? (table.getRowModel().rows.map(function (row) { return (<TableRow key={row.id} data-row-id={row.id} data-state={row.getIsSelected() && "selected"}>
              {row.getVisibleCells().map(function (cell) { return (<TableCell key={cell.id}>
                  {(0, react_table_1.flexRender)(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>); })}
            </TableRow>); })) : (<TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center">
              No data available
            </TableCell>
          </TableRow>)}
      </TableBody>
    </Table>);
};
exports.AutoTable = AutoTable;
