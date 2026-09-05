import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore/lite';

const firebaseConfig = {
  projectId: "ai-studio-remixremixremixr-8c567d77-3b0d-4111-85f4-1551be3cdb6b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const usersRef = collection(db, 'users');
  const snapshot = await getDocs(usersRef);
  const users = snapshot.docs.map(doc => doc.data());
  console.log(JSON.stringify(users, null, 2));
}

run().catch(console.error);
