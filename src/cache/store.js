const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function read(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function write(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function exists(filename) {
  return fs.existsSync(path.join(DATA_DIR, filename));
}

function ageMinutes(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return Infinity;
  const stat = fs.statSync(filePath);
  return (Date.now() - stat.mtimeMs) / 60000;
}

module.exports = { read, write, exists, ageMinutes };
