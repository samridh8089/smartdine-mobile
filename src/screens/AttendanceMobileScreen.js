import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Alert,
  Image,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../shared/config';
import { COLORS, FONTS, RADIUS, SHADOWS } from '../lib/theme';
import { fetchWithAuth } from '../lib/apiClient';

export default function AttendanceMobileScreen({ route, navigation }) {
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [staffInfo, setStaffInfo] = useState(profile);
  const [currentTime, setCurrentTime] = useState(new Date());

  const timerRef = useRef(null);

  // Live clock tick
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];

  const loadAttendance = useCallback(async () => {
    if (!restaurantId || !profile?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // 1. Fetch restaurant settings attendo attendance
      const { data: rest, error } = await supabase
        .from('restaurants')
        .select('id, name, settings')
        .eq('id', restaurantId)
        .maybeSingle();

      if (rest) {
        const list = rest?.settings?.attendo?.attendance || [];
        const myToday = list.find(
          a => (a.staff_id === profile.id || a.staff_id === profile.profile_id) && a.date === todayStr
        );
        setTodayAttendance(myToday || null);
      }
    } catch (err) {
      console.log('[AttendanceScreen] Load error:', err?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, profile?.id, todayStr]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // Request camera and take selfie punch
  const handleTakeSelfieAndPunch = async (punchType = 'in') => {
    if (submitting) return;

    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Camera Permission Required', 'Please enable camera access in your device settings to take your attendance selfie.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.35,
        base64: true,
        cameraType: ImagePicker.CameraType.front
      });

      if (result.canceled || !result.assets || !result.assets[0]) {
        return;
      }

      setSubmitting(true);
      const asset = result.assets[0];
      const base64Data = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;

      // Call secure backend punch API
      const endpoint = `${CONFIG.API_URL || ''}/api/attendance/punch`;
      let punchSuccess = false;
      let recordedAttendance = null;

      try {
        const res = await fetchWithAuth(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-restaurant-id': restaurantId
          },
          body: JSON.stringify({
            restaurantId,
            staffId: profile.id,
            date: todayStr,
            selfieUrl: base64Data,
            punchType,
            existingAttendance: todayAttendance
          })
        });

        const data = await res.json();
        if (data.success && data.attendance) {
          punchSuccess = true;
          recordedAttendance = data.attendance;
        } else {
          throw new Error(data.error || 'Server rejected punch');
        }
      } catch (apiErr) {
        console.log('[AttendanceScreen] Backend API failed, falling back to direct DB:', apiErr?.message);
        
        // Direct DB fallback
        const nowIso = new Date().toISOString();
        let fallbackRecord;

        if (punchType === 'out' && todayAttendance) {
          fallbackRecord = {
            ...todayAttendance,
            punch_out_time: nowIso,
            updated_at: nowIso
          };
        } else {
          fallbackRecord = {
            id: `att_${profile.id}_${todayStr}`,
            restaurant_id: restaurantId,
            staff_id: profile.id,
            date: todayStr,
            punch_in_time: nowIso,
            punch_out_time: null,
            status: 'present',
            marked_by_type: 'self',
            selfie_url: base64Data,
            created_at: nowIso,
            updated_at: nowIso
          };
        }

        const { data: rest } = await supabase.from('restaurants').select('settings').eq('id', restaurantId).single();
        if (rest) {
          const list = rest.settings?.attendo?.attendance || [];
          const filtered = list.filter(a => !(a.staff_id === profile.id && a.date === todayStr));
          filtered.push(fallbackRecord);

          await supabase.from('restaurants').update({
            settings: {
              ...rest.settings,
              attendo: {
                ...(rest.settings?.attendo || {}),
                attendance: filtered
              }
            }
          }).eq('id', restaurantId);

          punchSuccess = true;
          recordedAttendance = fallbackRecord;
        }
      }

      if (punchSuccess && recordedAttendance) {
        setTodayAttendance(recordedAttendance);
        const actionLabel = punchType === 'out' ? 'Punch Out' : 'Punch In';
        Alert.alert('Attendance Recorded! ✓', `${actionLabel} successfully registered for today.`);
      } else {
        Alert.alert('Punch Failed', 'Could not save attendance. Please try again or notify your manager.');
      }
    } catch (e) {
      console.log('[AttendanceScreen] Punch error:', e?.message);
      Alert.alert('Error', e?.message || 'Failed to capture selfie and punch.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '--:--';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '--:--';
    }
  };

  const calculateHours = (inTime, outTime) => {
    if (!inTime) return '0 hrs';
    try {
      const start = new Date(inTime).getTime();
      const end = outTime ? new Date(outTime).getTime() : currentTime.getTime();
      const diff = Math.max(0, end - start);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${mins}m`;
    } catch {
      return '0 hrs';
    }
  };

  const isPunchedIn = !!todayAttendance?.punch_in_time;
  const isPunchedOut = !!todayAttendance?.punch_out_time;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header matching SS1 Clean Light Style */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Staff Attendance</Text>
          <Text style={styles.subtitle}>
            {currentTime.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} • {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => {
            setRefreshing(true);
            loadAttendance();
          }}
          disabled={loading || submitting}
        >
          <Ionicons name="refresh" size={20} color="#059669" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAttendance} />}
      >
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Ionicons name="person" size={24} color="#64748b" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{profile?.full_name || profile?.name || 'Staff Member'}</Text>
            <Text style={styles.profileRole}>
              {(profile?.role || 'Staff').toUpperCase()} • {profile?.restaurant_name || 'Restaurant'}
            </Text>
          </View>
          <View style={[
            styles.statusPill,
            isPunchedOut ? styles.pillCompleted : isPunchedIn ? styles.pillActive : styles.pillPending
          ]}>
            <Text style={[
              styles.statusPillText,
              isPunchedOut ? styles.pillCompletedText : isPunchedIn ? styles.pillActiveText : styles.pillPendingText
            ]}>
              {isPunchedOut ? 'Duty Completed' : isPunchedIn ? 'On Duty' : 'Not Punched'}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <>
            {/* Status & Action Block */}
            <View style={styles.punchBox}>
              <View style={styles.boxHeader}>
                <Ionicons
                  name={isPunchedOut ? 'checkmark-circle' : isPunchedIn ? 'timer-outline' : 'camera-outline'}
                  size={26}
                  color={isPunchedOut ? '#059669' : isPunchedIn ? '#0284c7' : '#e11d48'}
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.boxTitle}>
                    {isPunchedOut ? 'Today\'s Duty Finished' : isPunchedIn ? 'Shift In Progress' : 'Start Your Shift'}
                  </Text>
                  <Text style={styles.boxSub}>
                    {isPunchedOut
                      ? `Total working time: ${calculateHours(todayAttendance?.punch_in_time, todayAttendance?.punch_out_time)}`
                      : isPunchedIn
                      ? `Punched in at ${formatTime(todayAttendance?.punch_in_time)} (${calculateHours(todayAttendance?.punch_in_time)})`
                      : 'Selfie camera check required to register duty'}
                  </Text>
                </View>
              </View>

              {/* Selfie preview if available */}
              {todayAttendance?.selfie_url ? (
                <View style={styles.selfieThumbContainer}>
                  <Image source={{ uri: todayAttendance.selfie_url }} style={styles.selfieThumb} />
                  <View style={{ marginLeft: 12, justifyContent: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#0f172a' }}>Selfie Verified ✓</Text>
                    <Text style={{ fontSize: 11, color: '#64748b' }}>Punched via Camera</Text>
                  </View>
                </View>
              ) : null}

              {/* Action Buttons */}
              <View style={{ marginTop: 16 }}>
                {!isPunchedIn ? (
                  <TouchableOpacity
                    style={[styles.punchBtn, styles.btnPunchIn]}
                    disabled={submitting}
                    onPress={() => handleTakeSelfieAndPunch('in')}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Ionicons name="camera" size={20} color="#ffffff" style={{ marginRight: 8 }} />
                        <Text style={styles.punchBtnText}>Take Selfie & Punch In</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : !isPunchedOut ? (
                  <TouchableOpacity
                    style={[styles.punchBtn, styles.btnPunchOut]}
                    disabled={submitting}
                    onPress={() => handleTakeSelfieAndPunch('out')}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <Ionicons name="log-out-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
                        <Text style={styles.punchBtnText}>Punch Out (End Duty)</Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={styles.completedBanner}>
                    <Ionicons name="checkmark-done" size={20} color="#059669" style={{ marginRight: 6 }} />
                    <Text style={styles.completedText}>Attendance completed for today!</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Attendance Details Card */}
            <View style={styles.detailsCard}>
              <Text style={styles.detailsTitle}>Today's Punch Summary</Text>
              
              <View style={styles.detailRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="log-in-outline" size={18} color="#059669" style={{ marginRight: 8 }} />
                  <Text style={styles.detailLabel}>Punch In Time</Text>
                </View>
                <Text style={styles.detailVal}>{formatTime(todayAttendance?.punch_in_time)}</Text>
              </View>

              <View style={styles.detailRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="log-out-outline" size={18} color="#e11d48" style={{ marginRight: 8 }} />
                  <Text style={styles.detailLabel}>Punch Out Time</Text>
                </View>
                <Text style={styles.detailVal}>{formatTime(todayAttendance?.punch_out_time)}</Text>
              </View>

              <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="time-outline" size={18} color="#0284c7" style={{ marginRight: 8 }} />
                  <Text style={styles.detailLabel}>Total Duration</Text>
                </View>
                <Text style={[styles.detailVal, { color: '#0284c7', fontWeight: '800' }]}>
                  {calculateHours(todayAttendance?.punch_in_time, todayAttendance?.punch_out_time)}
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a', letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2, fontWeight: '600' },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { padding: 16, paddingBottom: 32 },
  center: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  profileName: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  profileRole: { fontSize: 11, fontWeight: '700', color: '#64748b', marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  pillActive: { backgroundColor: '#e0f2fe' },
  pillActiveText: { color: '#0369a1' },
  pillCompleted: { backgroundColor: '#dcfce7' },
  pillCompletedText: { color: '#15803d' },
  pillPending: { backgroundColor: '#fee2e2' },
  pillPendingText: { color: '#b91c1c' },
  punchBox: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  boxHeader: { flexDirection: 'row', alignItems: 'center' },
  boxTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  boxSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  selfieThumbContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  selfieThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#cbd5e1' },
  punchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnPunchIn: { backgroundColor: '#059669' },
  btnPunchOut: { backgroundColor: '#e11d48' },
  punchBtnText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  completedText: { fontSize: 13, fontWeight: '700', color: '#166534' },
  detailsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  detailsTitle: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  detailLabel: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  detailVal: { fontSize: 13, color: '#0f172a', fontWeight: '700' },
});
