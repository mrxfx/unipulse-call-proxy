import admin from 'firebase-admin';

// Initialize Admin SDK using environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).send('Unauthorized');
    
    const idToken = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
        return res.status(401).send('Unauthorized');
    }

    const { callId } = req.body;
    if (!callId) return res.status(400).send('Missing callId');

    const callDoc = await db.collection('callSessions').doc(callId).get();
    if (!callDoc.exists) return res.status(404).send('Not found');
    
    const callData = callDoc.data();
    if (callData.callerUid !== decodedToken.uid || callData.notificationSent === true) {
        return res.status(403).send('Forbidden or already notified');
    }
    
    const devicesSnap = await db.collection('users').doc(callData.calleeUid)
        .collection('devices').where('isActive', '==', true).get();
        
    const tokens = devicesSnap.docs.map(doc => doc.data().fcmToken).filter(t => t);
    if (tokens.length === 0) return res.status(404).send('No active devices');

    await admin.messaging().sendMulticast({
        data: { type: 'CALL_INCOMING', callId, senderId: callData.callerUid, callType: callData.callType },
        tokens
    });
    await db.collection('callSessions').doc(callId).update({ notificationSent: true });
    
    return res.status(200).send('OK');
}
