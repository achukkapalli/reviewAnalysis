export interface ClusterOptions {
  eps?: number;     // Maximum distance between two points to be considered neighbors
  minPts?: number;  // Minimum number of points to form a dense region (cluster)
}

/**
 * Computes Euclidean distance between two vectors.
 * Since our embeddings are L2-normalized, Euclidean distance is mathematically
 * related to cosine similarity: Distance = sqrt(2 - 2 * similarity).
 */
export function euclideanDistance(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) {
    throw new Error('Vectors must have the same length');
  }
  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    const diff = v1[i] - v2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Pure TypeScript implementation of the DBSCAN clustering algorithm.
 * Runs directly on the high-dimensional (384-dim) normalized embeddings.
 * This avoids external Python bindings or native libraries and is extremely fast.
 * 
 * Returns an array of cluster IDs matching the input indices.
 * Noise points are assigned a cluster ID of -1.
 */
export function runClustering(embeddings: number[][], options: ClusterOptions = {}): number[] {
  const eps = options.eps !== undefined ? options.eps : 0.6; // Corresponds to ~0.82 cosine similarity
  const minPts = options.minPts !== undefined ? options.minPts : 3;
  
  const size = embeddings.length;
  const assignments = new Array<number>(size).fill(-2); // -2: unvisited, -1: noise, >=0: cluster ID
  let clusterId = 0;
  
  console.log(`[CLUSTERER] Running DBSCAN (eps=${eps}, minPts=${minPts}) on ${size} reviews.`);
  
  // Helper to find all neighbors of a point
  const getNeighbors = (index: number): number[] => {
    const neighbors: number[] = [];
    const target = embeddings[index];
    for (let i = 0; i < size; i++) {
      if (i === index) continue;
      if (euclideanDistance(target, embeddings[i]) <= eps) {
        neighbors.push(i);
      }
    }
    return neighbors;
  };
  
  for (let i = 0; i < size; i++) {
    if (assignments[i] !== -2) {
      continue; // Point already processed
    }
    
    const neighbors = getNeighbors(i);
    if (neighbors.length < minPts) {
      assignments[i] = -1; // Label as noise for now
      continue;
    }
    
    // Expand cluster
    assignments[i] = clusterId;
    const queue = [...neighbors];
    
    for (let j = 0; j < queue.length; j++) {
      const neighborIdx = queue[j];
      
      if (assignments[neighborIdx] === -1) {
        // Change noise point to cluster member
        assignments[neighborIdx] = clusterId;
      }
      
      if (assignments[neighborIdx] !== -2) {
        continue; // Point already visited
      }
      
      assignments[neighborIdx] = clusterId;
      const subNeighbors = getNeighbors(neighborIdx);
      
      if (subNeighbors.length >= minPts) {
        // Add new neighbors to queue if they aren't already in it
        for (const sn of subNeighbors) {
          if (!queue.includes(sn)) {
            queue.push(sn);
          }
        }
      }
    }
    
    clusterId++;
  }
  
  // Count cluster statistics
  const clusterCounts: Record<number, number> = {};
  for (const c of assignments) {
    clusterCounts[c] = (clusterCounts[c] || 0) + 1;
  }
  
  console.log(`[CLUSTERER] Found ${clusterId} clusters. Noise points count: ${clusterCounts[-1] || 0}`);
  for (let c = 0; c < clusterId; c++) {
    console.log(`[CLUSTERER] Cluster ${c}: ${clusterCounts[c]} members`);
  }
  
  return assignments;
}
