import { motion, useScroll, useTransform, type Variants, type Transition } from "framer-motion";
import { useRef } from "react";
import { SiTelegram, SiGithub } from "react-icons/si";
import { Terminal, Bug, ShieldCheck, CheckSquare, Code2 } from "lucide-react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const makeFadeUp = (delay = 0): Transition => ({
  delay,
  duration: 0.7,
  ease: EASE,
});

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: makeFadeUp(0) },
};

const skills = [
  {
    icon: Bug,
    title: "Анализ дефектов",
    desc: "Локализую проблему, собираю доказательства и отделяю баг от особенностей реализации.",
  },
  {
    icon: ShieldCheck,
    title: "Контроль релизов",
    desc: "Фокусируюсь на рисках, критичных сценариях и проверке изменений перед production.",
  },
  {
    icon: CheckSquare,
    title: "Тест-дизайн",
    desc: "Строю тесты не по кнопкам, а по логике продукта, данным и граничным условиям.",
  },
  {
    icon: Code2,
    title: "Системное мышление",
    desc: "Понимаю, как изменения в одной части системы влияют на остальной продукт.",
  },
];

export default function Home() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const orbY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);
  const orbOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div
      className="min-h-screen bg-background relative overflow-hidden text-foreground"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Сетка фона */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, hsl(var(--primary) / 0.06) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--primary) / 0.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Светящаяся орба с параллаксом */}
      <motion.div
        className="absolute top-[-10%] left-[10%] w-[55vw] h-[55vw] rounded-full pointer-events-none"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: "radial-gradient(circle, hsl(var(--primary) / 0.12) 0%, transparent 70%)",
          filter: "blur(60px)",
          y: orbY,
          opacity: orbOpacity,
        }}
      />
      <div
        className="absolute bottom-[5%] right-[5%] w-[35vw] h-[35vw] rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, hsl(var(--accent-foreground) / 0.08) 0%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />

      <main
        ref={heroRef}
        className="relative z-10 max-w-4xl mx-auto px-6 py-20 sm:px-12 sm:py-28 flex flex-col gap-16"
      >
        {/* Герой */}
        <section className="flex flex-col gap-5">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: makeFadeUp(0) },
            }}
            className="flex items-center gap-2 text-primary"
          >
            <Terminal size={16} strokeWidth={1.5} />
            <span
              className="text-xs tracking-[0.25em] uppercase"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              system_ready
            </span>
          </motion.div>

          <motion.h1
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0, y: 28 },
              visible: { opacity: 1, y: 0, transition: makeFadeUp(0.12) },
            }}
            className="text-5xl sm:text-7xl font-semibold tracking-tight text-white leading-none"
            style={{ fontFamily: "'Inter', sans-serif", letterSpacing: "-0.03em" }}
          >
            {"Татаринов "}
            <span className="whitespace-nowrap">
              Игорь
              <motion.span
                className="inline-block align-middle w-[3px] h-10 sm:h-14 bg-primary rounded-full ml-2"
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
              />
            </span>
          </motion.h1>

          <motion.h2
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0, transition: makeFadeUp(0.24) },
            }}
            className="text-lg sm:text-xl text-muted-foreground font-light tracking-wide"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            QA Engineer
          </motion.h2>

          {/* О себе */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0, transition: makeFadeUp(0.36) },
            }}
            className="flex items-center gap-4 mt-6"
          >
            <span
              className="text-xs tracking-[0.2em] text-primary uppercase shrink-0"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              about
            </span>
            <div className="h-px bg-border flex-1" />
          </motion.div>

          <motion.p
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0, transition: makeFadeUp(0.44) },
            }}
            className="text-base sm:text-lg text-foreground/75 max-w-2xl leading-[1.85] font-light"
          >
            Нахожу закономерности в поведении систем и замечаю проблемы до того, как они становятся критичными.
            Специализируюсь на backend/API тестировании, анализе логики продукта и проверке сложных сценариев.
            Тестирование для меня — это способ понять, насколько система действительно надёжна.
          </motion.p>
        </section>

        {/* Ключевые модули */}
        <section className="flex flex-col gap-8">
          <motion.div
            initial={{ opacity: 0, scaleX: 0.6 }}
            whileInView={{ opacity: 1, scaleX: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center gap-4 origin-left"
          >
            <div className="h-px bg-border flex-1" />
            <span
              className="text-xs tracking-[0.2em] text-primary uppercase shrink-0"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              core_modules
            </span>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {skills.map((skill, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 24, scale: 0.97 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: idx * 0.08, duration: 0.55, ease: EASE }}
                whileHover={{
                  borderColor: "hsl(var(--primary) / 0.6)",
                  backgroundColor: "hsl(var(--primary) / 0.05)",
                  transition: { duration: 0.2 },
                }}
                className="group p-6 border border-border bg-card/40 backdrop-blur-sm rounded-xl cursor-default"
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 5 }}
                  transition={{ type: "spring", stiffness: 400, damping: 15 }}
                  className="inline-block"
                >
                  <skill.icon className="w-7 h-7 text-primary mb-4" strokeWidth={1.5} />
                </motion.div>
                <h4
                  className="text-base font-semibold text-white mb-1.5"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {skill.title}
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed font-light">{skill.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Инструменты */}
        <section className="flex flex-col gap-8">
          <motion.div
            initial={{ opacity: 0, scaleX: 0.6 }}
            whileInView={{ opacity: 1, scaleX: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center gap-4 origin-left"
          >
            <div className="h-px bg-border flex-1" />
            <span
              className="text-xs tracking-[0.2em] text-primary uppercase shrink-0"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              tools_and_stack
            </span>
          </motion.div>

          <div className="flex flex-col gap-5">
            {[
              {
                category: "Core Stack",
                tools: ["Postman", "Charles Proxy", "PostgreSQL", "k6", "Docker"],
              },
              {
                category: "QA & Debugging",
                tools: ["Chrome DevTools", "Firefox DevTools", "SQL", "Linux CLI", "REST API", "Wagtail"],
              },
              {
                category: "Project Tools",
                tools: ["Jira", "Confluence", "Git", "GitHub", "Figma", "Google Docs", "TestOps", "Obsidian"],
              },
            ].map((group, gIdx) => (
              <motion.div
                key={gIdx}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: gIdx * 0.07, duration: 0.5, ease: EASE }}
                className="flex flex-col gap-2.5"
              >
                <span
                  className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {group.category}
                </span>
                <div className="flex flex-wrap gap-2">
                  {group.tools.map((tool, tIdx) => (
                    <motion.span
                      key={tIdx}
                      initial={{ opacity: 0, scale: 0.9 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: gIdx * 0.07 + tIdx * 0.04, duration: 0.4, ease: EASE }}
                      whileHover={{ borderColor: "hsl(var(--primary) / 0.7)", color: "hsl(var(--primary))", transition: { duration: 0.15 } }}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg bg-card/40 text-foreground/80 cursor-default select-none"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {tool}
                    </motion.span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Связаться */}
        <section className="flex flex-col gap-8">
          <motion.div
            initial={{ opacity: 0, scaleX: 0.6 }}
            whileInView={{ opacity: 1, scaleX: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center gap-4 origin-right"
          >
            <span
              className="text-xs tracking-[0.2em] text-primary uppercase shrink-0"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              connect
            </span>
            <div className="h-px bg-border flex-1" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex flex-wrap gap-3"
          >
            <motion.a
              href="https://t.me/tatarinovi"
              target="_blank"
              rel="noreferrer"
              data-testid="link-telegram"
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 350, damping: 20 }}
              className="flex items-center gap-3 px-6 py-3.5 border border-border rounded-xl bg-card/40 text-white hover:border-primary/50 hover:text-primary transition-colors duration-200"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              <SiTelegram className="w-4 h-4" />
              <span className="text-sm font-medium tracking-wide">Telegram</span>
            </motion.a>

            <motion.a
              href="https://github.com/k4t4my"
              target="_blank"
              rel="noreferrer"
              data-testid="link-github"
              whileHover={{ scale: 1.04, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 350, damping: 20 }}
              className="flex items-center gap-3 px-6 py-3.5 border border-border rounded-xl bg-card/40 text-white hover:border-primary/50 hover:text-primary transition-colors duration-200"
              style={{ fontFamily: "'Inter', sans-serif" }}
            >
              <SiGithub className="w-4 h-4" />
              <span className="text-sm font-medium tracking-wide">GitHub</span>
            </motion.a>
          </motion.div>
        </section>
      </main>

      {/* Нижняя акцентная полоска */}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ delay: 1.2, duration: 1.2, ease: EASE }}
        className="fixed bottom-0 w-full h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent origin-left pointer-events-none"
        style={{ zIndex: 40 }}
      />
    </div>
  );
}
