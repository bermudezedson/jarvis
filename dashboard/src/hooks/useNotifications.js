import { useState, useCallback } from 'react';

// In-memory notifications store — not persisted
let _notifs = [];
let _listeners = [];

function broadcast() { _listeners.forEach(fn => fn([..._notifs])); }

export function pushNotification(msg, type = 'info') {
  _notifs = [{ id: Date.now(), msg, type, at: new Date() }, ..._notifs].slice(0, 20);
  broadcast();
}

export function useNotifications() {
  const [notifs, setNotifs] = useState([..._notifs]);

  useState(() => {
    _listeners.push(setNotifs);
    return () => { _listeners = _listeners.filter(fn => fn !== setNotifs); };
  });

  const dismiss = useCallback(id => {
    _notifs = _notifs.filter(n => n.id !== id);
    broadcast();
  }, []);

  const clear = useCallback(() => { _notifs = []; broadcast(); }, []);

  return { notifs, dismiss, clear };
}
