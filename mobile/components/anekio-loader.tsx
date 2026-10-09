import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

const messages = ["Bridging the gap between schools and parents", "One platform, many possibilities."];

export function AnekioLoader() {
  const [messageIndex, setMessageIndex] = useState(0);
  const motion = useRef(new Animated.Value(0)).current;
  const messageOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(motion, { toValue: 1, duration: 1050, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(motion, { toValue: 0, duration: 1050, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [motion]);

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(messageOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
        setMessageIndex((current) => (current + 1) % messages.length);
        Animated.timing(messageOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
      });
    }, 2800);
    return () => clearInterval(interval);
  }, [messageOpacity]);

  const scale = motion.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });
  const lift = motion.interpolate({ inputRange: [0, 1], outputRange: [2, -4] });

  return (
    <View className="flex-1 items-center justify-center bg-[#F4F7FB] px-8" accessibilityRole="progressbar" accessibilityLabel="Loading Anekio">
      <Animated.View style={{ transform: [{ translateY: lift }, { scale }] }}>
        <Svg width={220} height={165} viewBox="0 0 400 300" accessibilityElementsHidden>
          <Defs>
            <LinearGradient id="anekioLoaderGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#1D4ED8" />
              <Stop offset="50%" stopColor="#3B82F6" />
              <Stop offset="70%" stopColor="#10B981" />
              <Stop offset="100%" stopColor="#22C55E" />
            </LinearGradient>
          </Defs>
          <Path d="M 200 150 C 140 70, 70 80, 70 150 C 70 215, 140 225, 200 150 C 260 75, 330 85, 330 150 C 330 215, 260 225, 200 150 Z" fill="none" stroke="url(#anekioLoaderGradient)" strokeWidth={36} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={200} cy={115} r={14} fill="#38BDF8" />
          <Path d="M 175 145 C 185 130, 200 125, 200 125 C 200 125, 215 130, 225 145" fill="none" stroke="#60A5FA" strokeWidth={12} strokeLinecap="round" />
          <Path d="M 185 85 C 180 75, 185 68, 192 72 C 196 79, 192 86, 185 85 Z" fill="#4ADE80" />
          <Path d="M 200 72 C 195 58, 205 58, 200 72 Z" fill="#22C55E" stroke="#22C55E" strokeWidth={8} strokeLinejoin="round" />
          <Path d="M 215 85 C 220 75, 215 68, 208 72 C 204 79, 208 86, 215 85 Z" fill="#4ADE80" />
        </Svg>
      </Animated.View>
      <Text className="mt-5 text-[27px] font-bold tracking-tight text-[#102A5C]">anekio</Text>
      <Animated.View style={{ opacity: messageOpacity }} className="mt-3 min-h-12 max-w-[290px] justify-center">
        <Text className="text-center text-[15px] font-medium leading-6 text-[#52627A]">{messages[messageIndex]}</Text>
      </Animated.View>
    </View>
  );
}
