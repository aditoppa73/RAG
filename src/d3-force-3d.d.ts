declare module 'd3-force-3d' {
  export function forceCollide(radius?: number | ((node: any) => number)): any;
  export function forceManyBody(): any;
  export function forceLink(links?: any[]): any;
  export function forceCenter(x?: number, y?: number, z?: number): any;
  export function forceRadial(radius: number, x?: number, y?: number, z?: number): any;
  export function forceSimulation(nodes?: any[]): any;
  export function forceX(x?: number): any;
  export function forceY(y?: number): any;
  export function forceZ(z?: number): any;
}

