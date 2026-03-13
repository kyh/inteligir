import type { Object3DNode } from "@react-three/fiber";
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import type { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

declare module "@react-three/fiber" {
  interface ThreeElements {
    line2: Object3DNode<Line2, typeof Line2>;
    lineMaterial: Object3DNode<LineMaterial, typeof LineMaterial>;
    lineGeometry: Object3DNode<LineGeometry, typeof LineGeometry>;
  }
}
