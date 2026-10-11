import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LangProvider, useLang } from './i18n';
import { SessionProvider, useSession } from './session';
import { useTheme } from './theme';
import Auth from './screens/Auth';
import Boards from './screens/Boards';
import Log from './screens/Log';
import Me from './screens/Me';
import Progress from './screens/Progress';
import Today from './screens/Today';
import Verify from './screens/Verify';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Tabs() {
  const { t } = useLang();
  const th = useTheme();
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: th.accent, tabBarStyle: { backgroundColor: th.card, borderTopColor: th.line } }}>
      <Tab.Screen name="Today" component={Today} options={{ title: t('tabs.today') }} />
      <Tab.Screen name="Log" component={Log} options={{ title: t('tabs.log') }} />
      <Tab.Screen name="Progress" component={Progress} options={{ title: t('tabs.progress') }} />
      <Tab.Screen name="Boards" component={Boards} options={{ title: t('tabs.boards') }} />
      <Tab.Screen name="Me" component={Me} options={{ title: t('tabs.me') }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, me } = useSession();
  const { t } = useLang();
  const th = useTheme();
  const scheme = useColorScheme();
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: th.bg }}><ActivityIndicator color={th.accent} /></View>;
  return (
    <NavigationContainer theme={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {me ? (
          <>
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="Verify" component={Verify as any} options={{ headerShown: true, title: t('verify.title') }} />
          </>
        ) : <Stack.Screen name="Auth" component={Auth} />}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LangProvider>
        <SessionProvider>
          <StatusBar style="auto" />
          <Root />
        </SessionProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
