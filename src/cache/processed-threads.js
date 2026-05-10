// processed-threads.js
// Cache persistente de threads ya procesados por Jarvis.
// Evita re-clasificar threads que no cambiaron.

const cache = require('./store');
const CACHE_FILE = 'processed-threads.json';

function load() {
  return cache.read(CACHE_FILE) || {
    threads: {},      // { thread_id: { hash, classification, updated_at } }
    last_scan_at: null,
    stats: { total_processed: 0, skipped: 0, new: 0, updated: 0 },
  };
}

function save(data) {
  cache.write(CACHE_FILE, data);
}

/**
 * Hash simple del thread para detectar cambios.
 * Si message_count o last_from_email o date cambia = hay actividad nueva.
 */
function hashThread(thread) {
  return `${thread.message_count}:${thread.last_from_email || ''}:${thread.date || ''}`;
}

/**
 * Determina si un thread necesita ser (re)procesado.
 * @returns {'new'|'updated'|'skip'}
 */
function shouldProcess(threadId, currentHash) {
  const data = load();
  const existing = data.threads[threadId];
  if (!existing) return 'new';
  if (existing.hash !== currentHash) return 'updated';
  return 'skip';
}

/**
 * Guarda un thread procesado en el cache.
 */
function markProcessed(threadId, hash, classification) {
  const data = load();
  data.threads[threadId] = {
    hash,
    classification,
    updated_at: new Date().toISOString(),
  };
  save(data);
}

/**
 * Obtiene la clasificación cacheada de un thread.
 */
function getCached(threadId) {
  const data = load();
  return data.threads[threadId]?.classification || null;
}

/**
 * Actualiza el timestamp del último escaneo a Gmail.
 */
function setLastScan() {
  const data = load();
  data.last_scan_at = new Date().toISOString();
  save(data);
}

/**
 * Obtiene el timestamp del último escaneo.
 * Usado por el modo incremental para saber desde cuándo buscar.
 */
function getLastScan() {
  const data = load();
  return data.last_scan_at;
}

/**
 * Retorna todas las clasificaciones cacheadas como array.
 * Usado para refresh_states sin llamar a Gmail.
 */
function getAllCached() {
  const data = load();
  return Object.values(data.threads)
    .map(t => t.classification)
    .filter(Boolean);
}

module.exports = {
  load, save, hashThread, shouldProcess,
  markProcessed, getCached, setLastScan, getLastScan, getAllCached,
};
