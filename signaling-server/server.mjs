import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.env.PORT || "8088", 10);
const wss = new WebSocketServer({ port: PORT });

let browserClient = null;
let cppClient = null;

console.log(`[Signaling Server] Listening on ws://localhost:${PORT}`);

function sendSafe(client, data) {
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(typeof data === "string" ? data : JSON.stringify(data));
  }
}

wss.on("connection", (ws) => {
  let role = null;
  console.log("[Signaling Server] New incoming client connection");

  ws.on("message", (rawMessage) => {
    try {
      const msg = JSON.parse(rawMessage.toString());

      switch (msg.type) {
        case "register": {
          role = msg.role;
          if (role === "browser") {
            browserClient = ws;
            console.log("[Signaling Server] Browser client registered");
            if (cppClient && cppClient.readyState === WebSocket.OPEN) {
              // Notify browser that C++ peer is ready so it can initiate SDP offer
              sendSafe(browserClient, { type: "cpp-ready" });
            }
          } else if (role === "cpp") {
            cppClient = ws;
            console.log("[Signaling Server] C++ client registered");
            if (browserClient && browserClient.readyState === WebSocket.OPEN) {
              // Trigger browser to generate an SDP offer for C++
              sendSafe(browserClient, { type: "cpp-ready" });
            }
          }
          break;
        }

        case "offer": {
          console.log("[Signaling Server] Forwarding SDP Offer from Browser to C++");
          if (cppClient) {
            sendSafe(cppClient, msg);
          } else {
            console.warn("[Signaling Server] C++ client not connected to receive Offer");
          }
          break;
        }

        case "answer": {
          console.log("[Signaling Server] Forwarding SDP Answer from C++ to Browser");
          if (browserClient) {
            sendSafe(browserClient, msg);
          } else {
            console.warn("[Signaling Server] Browser client not connected to receive Answer");
          }
          break;
        }

        case "candidate": {
          // Route ICE candidate to opposing peer
          if (ws === browserClient && cppClient) {
            sendSafe(cppClient, msg);
          } else if (ws === cppClient && browserClient) {
            sendSafe(browserClient, msg);
          }
          break;
        }

        default:
          console.log("[Signaling Server] Unknown message type:", msg.type);
      }
    } catch (err) {
      console.error("[Signaling Server] Error parsing message:", err);
    }
  });

  ws.on("close", () => {
    if (ws === browserClient) {
      console.log("[Signaling Server] Browser client disconnected");
      browserClient = null;
    } else if (ws === cppClient) {
      console.log("[Signaling Server] C++ client disconnected");
      cppClient = null;
    }
  });

  ws.on("error", (err) => {
    console.error("[Signaling Server] Client error:", err);
  });
});
