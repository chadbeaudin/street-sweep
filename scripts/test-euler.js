const eulerianTrail = require('eulerian-trail');

const edges = [
  ['A', 'B'],
  ['A', 'B'],
  ['C', 'D'],
  ['C', 'D']
];

try {
  const trail = eulerianTrail({ edges });
  console.log('Trail length:', trail.length, trail);
} catch (e) {
  console.error('Error:', e.message);
}
