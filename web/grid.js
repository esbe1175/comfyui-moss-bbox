import {clamp} from './state.js';
import {selectionBounds} from './groups.js';

function grid(dimensions, step) {
 const {width, height} = dimensions || {};
 if (![width, height, step].every(value => Number.isFinite(value) && value > 0)) throw new Error('Grid dimensions and spacing must be positive numbers.');
 return {width, height, step};
}

const nearest = (value, extent, step) => clamp(Math.round(clamp(value, 0, 1) * extent / step) * step, 0, extent);
const pixel = value => Number(value.toFixed(9));

export function snapPoint(point, dimensions, step = 16) {
 const {width, height} = grid(dimensions, step);
 return [nearest(point[0], width, step) / width, nearest(point[1], height, step) / height];
}

export function snapBox(bbox, dimensions, step = 16) {
 const {width, height} = grid(dimensions, step);
 let left = nearest(bbox[0], width, step), top = nearest(bbox[1], height, step);
 let right = nearest(bbox[2], width, step), bottom = nearest(bbox[3], height, step);
 const cellX = Math.min(step, width), cellY = Math.min(step, height);
 right = Math.min(width, Math.max(right, left + cellX));
 bottom = Math.min(height, Math.max(bottom, top + cellY));
 left = Math.max(0, Math.min(left, right - cellX));
 top = Math.max(0, Math.min(top, bottom - cellY));
 return [left / width, top / height, right / width, bottom / height];
}

// Single boxes snap their origin; relative moves retain each member's grid phase.
export function snapMove(state, ids, dx, dy, dimensions, step = 16, {relative = false} = {}) {
 grid(dimensions, step);
 const bounds = selectionBounds(state, ids);
 if (!bounds) return [0, 0];
 if (relative) {
  return [dimensions.width, dimensions.height].map((extent, axis) => {
   const requested = Math.round(pixel((axis === 0 ? dx : dy) * extent / step));
   const min = Math.ceil(pixel(-bounds[axis] * extent / step));
   const max = Math.floor(pixel((1 - bounds[axis + 2]) * extent / step));
   return clamp(requested, min, max) * step / extent;
  });
 }
 const target = snapPoint([bounds[0] + dx, bounds[1] + dy], dimensions, step);
 return [clamp(target[0] - bounds[0], -bounds[0], 1 - bounds[2]), clamp(target[1] - bounds[1], -bounds[1], 1 - bounds[3])];
}

export function snapResize(bbox, handle, point, dimensions, step = 16) {
 const {width, height} = grid(dimensions, step), result = [...bbox];
 const x = nearest(point[0], width, step), y = nearest(point[1], height, step);
 const left = pixel(bbox[0] * width), top = pixel(bbox[1] * height), right = pixel(bbox[2] * width), bottom = pixel(bbox[3] * height);
 const cellX = Math.min(step, width), cellY = Math.min(step, height);
 if (handle.includes('w')) {
  const limit = Math.floor(pixel((right - cellX) / step)) * step;
  if (limit >= 0) result[0] = clamp(x, 0, limit) / width;
 }
 if (handle.includes('n')) {
  const limit = Math.floor(pixel((bottom - cellY) / step)) * step;
  if (limit >= 0) result[1] = clamp(y, 0, limit) / height;
 }
 if (handle.includes('e')) {
  const limit = Math.ceil(pixel((left + cellX) / step)) * step;
  if (limit <= width) result[2] = clamp(x, limit, width) / width;
 }
 if (handle.includes('s')) {
  const limit = Math.ceil(pixel((top + cellY) / step)) * step;
  if (limit <= height) result[3] = clamp(y, limit, height) / height;
 }
 // A tiny imported box at a canvas edge may have no feasible one-cell resize.
 // Keep that axis intact instead of changing its opposite, inactive edge.
 return result;
}
