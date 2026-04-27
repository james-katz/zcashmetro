/**
 * Pathfinding utilities for tile-based navigation.
 *
 * Uses BFS (Breadth-First Search) to find the shortest path between
 * two tiles on the station grid, respecting collision tiles.
 */

/**
 * Get walkable neighbor tiles for a given node.
 * Supports 6 directions: 4 cardinal + 2 diagonal (SW, NE).
 * @param {{ x: number, y: number }} node  Current grid tile
 * @param {object[][]} grid  2D array of tile objects with `collides` property
 * @returns {object[]} Array of walkable neighbor tiles
 */
function getNeighbors(node, grid) {
  const neighbors = [];
  const dirs = [
    [1, 0],   // right
    [0, 1],   // down
    [-1, 0],  // left
    [0, -1],  // up
    [-1, -1], // top-left diagonal
    [1, 1],   // bottom-right diagonal
  ];

  for (const [dx, dy] of dirs) {
    const x = node.x + dx;
    const y = node.y + dy;

    if (grid[y] && grid[y][x] && grid[y][x].collides !== true) {
      neighbors.push(grid[y][x]);
    }
  }

  return neighbors;
}

/**
 * Perform a BFS search from `start` to `goal` on the tile grid.
 * Returns an array of tile objects representing the path (inclusive of
 * start and goal), or an empty array if no path is found.
 *
 * @param {{ x: number, y: number }} start  Starting tile
 * @param {{ x: number, y: number }} goal   Target tile
 * @param {object[][]} grid  2D tile grid
 * @returns {object[]} Ordered path from start to goal
 */
export function bfs(start, goal, grid) {
  if (!start || !goal) return [];

  const queue = [];
  const cameFrom = new Map();
  queue.push(start);
  cameFrom.set(start, null);

  while (queue.length > 0) {
    const current = queue.shift();

    if (current === goal) {
      const path = [];
      let temp = current;
      while (temp) {
        path.push(temp);
        temp = cameFrom.get(temp);
      }
      return path.reverse();
    }

    const neighbors = getNeighbors(current, grid);
    for (const neighbor of neighbors) {
      if (!cameFrom.has(neighbor)) {
        queue.push(neighbor);
        cameFrom.set(neighbor, current);
      }
    }
  }

  return [];
}
