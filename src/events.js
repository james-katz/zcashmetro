/**
 * ZcashMetro Event Bridge
 *
 * Simple event emitter that connects the Phaser game world
 * with the HTML overlay layer. Attached to `window.zmEvents`.
 *
 * Events:
 *   stats      — { height: string, mempool: number }
 *   npcHover   — { txid, txType, typeText, screenX, screenY }
 *   npcHoverEnd
 *   npcClick   — { txid, txType, typeText }
 *   trainDepart
 *   trainArrive
 */

class EventBridge {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Register a listener for an event.
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  /**
   * Remove a listener.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const set = this.listeners.get(event);
    if (set) set.delete(callback);
  }

  /**
   * Emit an event with data.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(data);
        } catch (err) {
          console.error(`EventBridge error in '${event}':`, err);
        }
      }
    }
  }
}

// Singleton attached to window for cross-layer access
if (!window.zmEvents) {
  window.zmEvents = new EventBridge();
}

export default window.zmEvents;
