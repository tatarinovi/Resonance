import { useEffect, useRef } from "react";
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

if (Platform.OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `* { scrollbar-width: none; } *::-webkit-scrollbar { display: none; }`;
  document.head.appendChild(style);
}
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";

const skills = [
  {
    icon: "alert-circle" as const,
    title: "Отслеживание дефектов",
    desc: "Точная локализация аномалий и документирование воспроизводимых шагов.",
  },
  {
    icon: "shield" as const,
    title: "Обеспечение качества",
    desc: "Строгое ручное тестирование в разнообразных средах и сценариях.",
  },
  {
    icon: "check-square" as const,
    title: "Проектирование тест-кейсов",
    desc: "Создание комплексных тест-сьютов, охватывающих граничные условия.",
  },
  {
    icon: "code" as const,
    title: "Системный анализ",
    desc: "Глубокое погружение в архитектуру продукта для предотвращения сбоев.",
  },
];

const toolGroups = [
  {
    category: "Core Stack",
    tools: ["Postman", "Charles Proxy", "PostgreSQL", "k6", "Docker"],
  },
  {
    category: "QA & Debugging",
    tools: ["Chrome DevTools", "SQL", "Linux CLI", "REST API", "Wagtail"],
  },
  {
    category: "Project Tools",
    tools: ["Jira", "Confluence", "Git", "GitHub", "Figma", "TestOps"],
  },
];

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const cursorOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(cursorOpacity, {
          toValue: 0,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(cursorOpacity, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const s = makeStyles(colors);

  return (
    <ScrollView
      style={[s.scroll, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        s.content,
        { paddingTop: topPad + 36, paddingBottom: bottomPad + 56 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.orb} pointerEvents="none" />
      <View style={s.orbBottom} pointerEvents="none" />

      {/* Hero */}
      <View style={s.section}>
        <View style={s.statusRow}>
          <Feather name="terminal" size={12} color={colors.primary} />
          <Text style={[s.mono, s.statusText]}>system_ready</Text>
        </View>

        <View style={s.nameRow}>
          <Text style={s.name}>Татаринов </Text>
          <View style={s.nameLastGroup}>
            <Text style={s.name}>Игорь</Text>
            <Animated.View style={[s.cursor, { opacity: cursorOpacity }]} />
          </View>
        </View>

        <Text style={[s.mono, s.role]}>QA Engineer</Text>

        <View style={s.dividerRow}>
          <Text style={[s.mono, s.label]}>about</Text>
          <View style={s.line} />
        </View>

        <Text style={s.about}>
          Нахожу ясность в структурированных системах и замечаю то, что
          упускают другие. Специализируюсь на систематическом тестировании,
          поиске граничных случаев и обеспечении качества продукта. Не просто
          тестирую ПО — анализирую логику, чтобы сделать продукт надёжнее.
        </Text>
      </View>

      {/* Core Modules */}
      <View style={s.section}>
        <View style={s.dividerRowReverse}>
          <View style={s.line} />
          <Text style={[s.mono, s.label]}>core_modules</Text>
        </View>

        <View style={s.grid}>
          {skills.map((skill, idx) => (
            <View key={idx} style={s.card}>
              <Feather
                name={skill.icon}
                size={20}
                color={colors.primary}
                style={{ marginBottom: 10 }}
              />
              <Text style={s.cardTitle}>{skill.title}</Text>
              <Text style={s.cardDesc}>{skill.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Tools & Stack */}
      <View style={s.section}>
        <View style={s.dividerRowReverse}>
          <View style={s.line} />
          <Text style={[s.mono, s.label]}>инструменты_и_стек</Text>
        </View>

        {toolGroups.map((group, gIdx) => (
          <View key={gIdx} style={s.toolGroup}>
            <Text style={[s.mono, s.toolCategory]}>{group.category}</Text>
            <View style={s.toolRow}>
              {group.tools.map((tool, tIdx) => (
                <View key={tIdx} style={s.tag}>
                  <Text style={[s.mono, s.tagText]}>{tool}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* Connect */}
      <View style={s.section}>
        <View style={s.dividerRow}>
          <Text style={[s.mono, s.label]}>connect</Text>
          <View style={s.line} />
        </View>

        <View style={s.connectRow}>
          <Pressable
            style={({ pressed }) => [
              s.connectBtn,
              pressed && s.connectBtnPressed,
            ]}
            onPress={() => Linking.openURL("https://t.me/tatarinovi")}
            testID="link-telegram"
          >
            <Feather name="send" size={15} color={colors.foreground} />
            <Text style={s.connectText}>Telegram</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              s.connectBtn,
              pressed && s.connectBtnPressed,
            ]}
            onPress={() => Linking.openURL("https://github.com/k4t4my")}
            testID="link-github"
          >
            <Feather name="github" size={15} color={colors.foreground} />
            <Text style={s.connectText}>GitHub</Text>
          </Pressable>
        </View>
      </View>

      {/* Bottom accent line */}
      <View style={s.accentLine} />
    </ScrollView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    scroll: { flex: 1 },
    content: { paddingHorizontal: 24, gap: 44 },

    orb: {
      position: "absolute",
      top: -80,
      left: -60,
      width: 300,
      height: 300,
      borderRadius: 150,
      backgroundColor: colors.primary,
      opacity: 0.07,
    },
    orbBottom: {
      position: "absolute",
      bottom: 200,
      right: -80,
      width: 220,
      height: 220,
      borderRadius: 110,
      backgroundColor: colors.primary,
      opacity: 0.04,
    },

    section: { gap: 18 },

    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    statusText: {
      fontSize: 10,
      letterSpacing: 3.5,
      textTransform: "uppercase",
      color: colors.primary,
    },

    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
    },
    nameLastGroup: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    name: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 32,
      color: "#ffffff",
      letterSpacing: -0.5,
    },
    cursor: {
      width: 3,
      height: 34,
      borderRadius: 2,
      backgroundColor: colors.primary,
    },

    role: {
      fontSize: 14,
      color: colors.mutedForeground,
      letterSpacing: 1.5,
    },

    dividerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    dividerRowReverse: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    label: {
      fontSize: 9,
      letterSpacing: 3,
      textTransform: "uppercase",
      color: colors.primary,
    },
    line: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },

    about: {
      fontFamily: "Inter_400Regular",
      fontSize: 14,
      color: colors.mutedForeground,
      lineHeight: 23,
    },

    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    card: {
      width: "47.5%",
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      padding: 16,
    },
    cardTitle: {
      fontFamily: "Inter_600SemiBold",
      fontSize: 13,
      color: "#ffffff",
      marginBottom: 6,
    },
    cardDesc: {
      fontFamily: "Inter_400Regular",
      fontSize: 12,
      color: colors.mutedForeground,
      lineHeight: 17,
    },

    toolGroup: { gap: 8 },
    toolCategory: {
      fontSize: 9,
      letterSpacing: 2.5,
      textTransform: "uppercase",
      color: colors.mutedForeground,
    },
    toolRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    tag: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      backgroundColor: colors.card,
    },
    tagText: {
      fontSize: 11,
      color: colors.foreground,
      opacity: 0.85,
    },

    connectRow: {
      flexDirection: "row",
      gap: 10,
    },
    connectBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.card,
    },
    connectBtnPressed: {
      borderColor: colors.primary,
      opacity: 0.8,
    },
    connectText: {
      fontFamily: "Inter_500Medium",
      fontSize: 13,
      color: "#ffffff",
      letterSpacing: 0.3,
    },

    accentLine: {
      height: 1,
      backgroundColor: colors.primary,
      opacity: 0.25,
      marginTop: 8,
    },

    mono: {
      fontFamily: "Inter_400Regular",
    },
  });
}
