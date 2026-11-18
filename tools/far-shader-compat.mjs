/** Historical water comparisons exclude only the exact authorised distant vertex
 * bend. The complete resulting programs stay pinned above, including LOW. */
export function withoutFarBend(source) {
 return source
  .replace("import { CURVE_GLSL } from './far-rules';\n\n", '')
  .replaceAll('#include <logdepthbuf_pars_vertex>\n${CURVE_GLSL}\nuniform float farCurveOn;', '#include <logdepthbuf_pars_vertex>')
  .replaceAll('  float drop = farDrop(w.xz - cameraPosition.xz) * farCurveOn;\n  if (drop > 0.0) gl_Position -= projectionMatrix * viewMatrix * vec4(0.0,drop,0.0,0.0);\n', '');
}
