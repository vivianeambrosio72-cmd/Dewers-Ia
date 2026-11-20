import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, isAdminUser, OperationType } from '../firebase';
import type {
  SavedProject,
  StyleConfig,
  SubtitleSegment,
  SupportedLanguage,
  TransitionConfig,
} from '../types';

export async function upsertUserProfile(user: User): Promise<void> {
  if (!user.email && !user.phoneNumber) return;
  const userRef = doc(db, 'users', user.uid);
  const path = `users/${user.uid}`;
  try {
    const existing = await getDoc(userRef);
    const displayName = (
      user.displayName ||
      user.email?.split('@')[0] ||
      user.phoneNumber ||
      'Criador'
    ).slice(0, 120);
    const hasGoogleProvider = user.providerData.some(
      (provider) => provider.providerId === 'google.com',
    );
    const authProvider: 'google' | 'phone' = hasGoogleProvider ? 'google' : 'phone';
    const role: 'admin' | 'user' = isAdminUser(user) ? 'admin' : 'user';

    if (!existing.exists()) {
      const payload: Record<string, unknown> = {
        uid: user.uid,
        displayName,
        role,
        authProvider,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (user.email) {
        payload.email = user.email.slice(0, 254);
      }
      if (user.phoneNumber) {
        payload.phoneNumber = user.phoneNumber.slice(0, 32);
      }
      if (user.photoURL && user.photoURL.length <= 1000) {
        payload.photoURL = user.photoURL;
      }
      await setDoc(userRef, payload);
    } else {
      const updatePayload: Record<string, unknown> = {
        displayName,
        role,
        authProvider,
        updatedAt: serverTimestamp(),
      };
      if (user.email) {
        updatePayload.email = user.email.slice(0, 254);
      }
      if (user.phoneNumber) {
        updatePayload.phoneNumber = user.phoneNumber.slice(0, 32);
      }
      if (user.photoURL && user.photoURL.length <= 1000) {
        updatePayload.photoURL = user.photoURL;
      }
      await updateDoc(userRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function sanitizeSegmentsForFirestore(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.slice(0, 300).map((seg) => ({
    id: seg.id.slice(0, 64),
    text: seg.text.slice(0, 500),
    start: Number(seg.start.toFixed(3)),
    end: Number(seg.end.toFixed(3)),
    words: seg.words.slice(0, 40).map((w) => ({
      id: w.id.slice(0, 64),
      text: w.text.slice(0, 100),
      start: Number(w.start.toFixed(3)),
      end: Number(w.end.toFixed(3)),
      ...(typeof w.confidence === 'number' ? { confidence: Number(w.confidence.toFixed(2)) } : {}),
      ...(typeof w.needsReview === 'boolean' ? { needsReview: w.needsReview } : {}),
    })),
  }));
}

export async function saveSubtitleProject(params: {
  projectId?: string;
  ownerId: string;
  title: string;
  videoFileName: string;
  duration: number;
  language: SupportedLanguage;
  styleConfig: StyleConfig;
  transitionConfig: TransitionConfig;
  transitionPoints?: import('../types').TransitionPoint[];
  segments: SubtitleSegment[];
}): Promise<string> {
  const id =
    params.projectId && /^[a-zA-Z0-9_\-]+$/.test(params.projectId)
      ? params.projectId
      : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const cleanSegments = sanitizeSegmentsForFirestore(params.segments);
  const wordCount = Math.min(
    10000,
    cleanSegments.reduce((acc, s) => acc + s.words.length, 0),
  );

  const safeStyle: StyleConfig = {
    preset: params.styleConfig.preset,
    fontFamily: params.styleConfig.fontFamily.slice(0, 80),
    fontScale: Math.min(150, Math.max(50, Math.round(params.styleConfig.fontScale ?? 100))),
    textColor: params.styleConfig.textColor.slice(0, 24),
    highlightColor: params.styleConfig.highlightColor.slice(0, 24),
    verticalPosition: Math.min(95, Math.max(5, Math.round(params.styleConfig.verticalPosition ?? 75))),
  };

  const safeTransition: TransitionConfig = {
    enabled: Boolean(params.transitionConfig.enabled),
    mode: params.transitionConfig.mode,
    type: params.transitionConfig.type,
    intensity: params.transitionConfig.intensity,
    pauseThreshold: Math.min(3.0, Math.max(0.3, Number(params.transitionConfig.pauseThreshold.toFixed(2)))),
    duration: Math.min(2.0, Math.max(0.15, Number((params.transitionConfig.duration ?? 0.45).toFixed(2)))),
  };

  const safeTransitionPoints = (params.transitionPoints ?? []).slice(0, 120).map((tp) => ({
    id: tp.id.slice(0, 64),
    time: Number(Math.max(0, tp.time).toFixed(3)),
    type: tp.type,
    duration: Math.min(2.0, Math.max(0.15, Number(tp.duration.toFixed(2)))),
    intensity: tp.intensity,
    source: tp.source,
    ...(typeof tp.pauseDuration === 'number' ? { pauseDuration: Number(tp.pauseDuration.toFixed(2)) } : {}),
  }));

  const docRef = doc(db, 'projects', id);
  const path = `projects/${id}`;

  try {
    const existing = await getDoc(docRef);
    const title = (params.title.trim() || 'Projeto sem título').slice(0, 160);
    const videoFileName = (params.videoFileName.trim() || 'video.mp4').slice(0, 200);
    const duration = Math.min(3600, Math.max(0, Number(params.duration.toFixed(2))));

    if (!existing.exists()) {
      await setDoc(docRef, {
        id,
        ownerId: params.ownerId,
        title,
        videoFileName,
        duration,
        language: params.language,
        styleConfig: safeStyle,
        transitionConfig: safeTransition,
        transitionPoints: safeTransitionPoints,
        segments: cleanSegments,
        wordCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        title,
        videoFileName,
        duration,
        language: params.language,
        styleConfig: safeStyle,
        transitionConfig: safeTransition,
        transitionPoints: safeTransitionPoints,
        segments: cleanSegments,
        wordCount,
        updatedAt: serverTimestamp(),
      });
    }
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserProjects(
  ownerId: string,
  onData: (projects: SavedProject[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const path = 'projects';
  const q = query(
    collection(db, 'projects'),
    where('ownerId', '==', ownerId),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as SavedProject);
      list.sort((a, b) => {
        const aSec = (a.updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
        const bSec = (b.updatedAt as { seconds?: number } | undefined)?.seconds ?? 0;
        return bSec - aSec;
      });
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    },
  );
}

export async function deleteSubtitleProject(projectId: string): Promise<void> {
  const path = `projects/${projectId}`;
  try {
    await deleteDoc(doc(db, 'projects', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
