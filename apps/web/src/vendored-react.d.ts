// Next's own builds of React, which every page it serves runs in place of the npm packages
declare module "next/dist/compiled/react" {
  import React from "react";

  export = React;
}

declare module "next/dist/compiled/react-dom" {
  export * from "react-dom";
}

declare module "next/dist/compiled/react-dom/client" {
  export * from "react-dom/client";
}
