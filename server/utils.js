const WebSocket = require('ws');

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function broadcast(room, senderId, message) {
  room.forEach((client, id) => {
    if (id !== senderId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

module.exports = { generateId, broadcast };
