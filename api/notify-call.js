import admin from "firebase-admin";

// --------------------------------------------------
// Firebase Admin initialization
// --------------------------------------------------

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT environment variable is missing");
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();


// --------------------------------------------------
// Vercel Serverless Function
// POST /api/notify-call
// --------------------------------------------------

export default async function handler(req, res) {

  // Only POST is allowed
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {

    // ------------------------------------------------
    // 1. Verify Firebase Authentication token
    // ------------------------------------------------

    const authHeader = req.headers.authorization;

    if (
      !authHeader ||
      !authHeader.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const idToken = authHeader.substring(7);

    let decodedToken;

    try {
      decodedToken = await admin
        .auth()
        .verifyIdToken(idToken);
    } catch (error) {

      console.error(
        "Firebase token verification failed:",
        error
      );

      return res.status(401).json({
        success: false,
        error: "Invalid authentication token",
      });
    }


    // ------------------------------------------------
    // 2. Read request body
    // ------------------------------------------------

    const { callId } = req.body || {};

    if (
      !callId ||
      typeof callId !== "string"
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing callId",
      });
    }


    // ------------------------------------------------
    // 3. Load call session
    // ------------------------------------------------

    const callRef = db
      .collection("callSessions")
      .doc(callId);

    const callDoc = await callRef.get();

    if (!callDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Call session not found",
      });
    }

    const callData = callDoc.data();

    if (!callData) {
      return res.status(404).json({
        success: false,
        error: "Invalid call session",
      });
    }


    // ------------------------------------------------
    // 4. Verify caller
    // ------------------------------------------------

    if (
      callData.callerUid !== decodedToken.uid
    ) {
      return res.status(403).json({
        success: false,
        error: "Caller verification failed",
      });
    }


    // ------------------------------------------------
    // 5. Validate call participants
    // ------------------------------------------------

    if (
      !callData.calleeUid ||
      callData.calleeUid === callData.callerUid
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid callee",
      });
    }


    // ------------------------------------------------
    // 6. Validate call type
    // ------------------------------------------------

    if (
      callData.callType !== "AUDIO" &&
      callData.callType !== "VIDEO"
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid call type",
      });
    }


    // ------------------------------------------------
    // 7. Prevent duplicate notifications
    // ------------------------------------------------

    if (callData.notificationSent === true) {
      return res.status(409).json({
        success: false,
        error: "Notification already sent",
      });
    }


    // ------------------------------------------------
    // 8. Get callee's active devices
    // ------------------------------------------------

    const devicesSnap = await db
      .collection("users")
      .doc(callData.calleeUid)
      .collection("devices")
      .where("isActive", "==", true)
      .get();


    // ------------------------------------------------
    // 9. Collect FCM tokens
    // ------------------------------------------------

    const tokens = devicesSnap.docs
      .map((doc) => {
        const data = doc.data();
        return data?.fcmToken;
      })
      .filter(
        (token) =>
          typeof token === "string" &&
          token.trim().length > 0
      );


    if (tokens.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No active devices found",
      });
    }


    // ------------------------------------------------
    // 10. Create FCM message
    // ------------------------------------------------

    const message = {
      data: {
        type: "CALL_INCOMING",

        callId: String(callId),

        senderId: String(
          callData.callerUid
        ),

        callType: String(
          callData.callType
        ),
      },

      tokens,
    };


    // ------------------------------------------------
    // 11. Send FCM notification
    // ------------------------------------------------

    const fcmResponse = await admin
      .messaging()
      .sendEachForMulticast(message);


    // ------------------------------------------------
    // 12. Mark notification as sent
    // ------------------------------------------------

    await callRef.update({
      notificationSent: true,

      notificationSentAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });


    // ------------------------------------------------
    // 13. Return success
    // ------------------------------------------------

    return res.status(200).json({
      success: true,

      sent: fcmResponse.successCount,

      failed: fcmResponse.failureCount,

      total: tokens.length,
    });

  } catch (error) {

    console.error(
      "notify-call error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
}
