import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api } from './api';

export type UploadPurpose = 'avatar' | 'kitchen' | 'menu_item' | 'review' | 'verification_doc';

/** Pick (library or camera) then upload. Permissions are requested only at the moment of use. */
export async function pickAndUpload(
  purpose: UploadPurpose,
  source: 'library' | 'camera' = 'library',
): Promise<{ key: string; url: string | null } | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted && Platform.OS !== 'web')
    throw Object.assign(new Error('permission'), { permissionDenied: true });
  const res = await (
    source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync
  )({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const form = new FormData();
  form.append('purpose', purpose);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(a.uri)).blob();
    form.append('file', blob, a.fileName ?? 'photo.jpg');
  } else {
    form.append('file', {
      uri: a.uri,
      name: a.fileName ?? 'photo.jpg',
      type: a.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
  }
  return api<{ key: string; url: string | null }>('/uploads', { method: 'POST', form });
}
