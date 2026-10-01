import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Play,
  Layers,
  ShieldCheck,
  Cpu,
  Terminal,
  Activity,
  CheckCircle2,
  AlertTriangle,
  GitBranch,
  Flame,
  Sparkles,
} from 'lucide-react';

interface SlidesProps {
  onLaunchDemo?: () => void;
  onOpenTab?: (tab: string) => void;
}

interface SlideItem {
  id: number;
  category: string;
  title: string;
  subtitle: string;
  badge?: string;
  content: React.ReactNode;
}

export const SlidesPresentation: React.FC<SlidesProps> = ({ onLaunchDemo, onOpenTab }) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeVendorTab, setActiveVendorTab] = useState<'cisco' | 'arista' | 'juniper' | 'eltex' | 'yadro'>('arista');

  const slides: SlideItem[] = [
    // SLIDE 1: Title & Vision
    {
      id: 1,
      category: 'ОБЗОР ПЛАТФОРМЫ',
      title: 'CROC DREAM NetOps',
      subtitle: 'Гетерогенная автоматизация CLOS-фабрики и непрерывный контроль конфигураций',
      badge: 'КРОК × МТУСИ 2026',
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
              <div className="flex items-center space-x-2 text-cyan-400 text-xs font-mono">
                <Layers className="w-4 h-4" />
                <span>АРХИТЕКТУРА</span>
              </div>
              <h4 className="text-white text-sm font-semibold">Идеология Яндекс Аннушки</h4>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Декларативный Git SoT, генерация текстовых конфигураций, иерархический diff и транзакционный накат.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
              <div className="flex items-center space-x-2 text-emerald-400 text-xs font-mono">
                <ShieldCheck className="w-4 h-4" />
                <span>НАДЕЖНОСТЬ</span>
              </div>
              <h4 className="text-white text-sm font-semibold">Zero-Downtime Guard</h4>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Commit confirmed (таймер 180с), автоматические post-check тесты и мгновенный откат при потере связности.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
              <div className="flex items-center space-x-2 text-purple-400 text-xs font-mono">
                <Sparkles className="w-4 h-4" />
                <span>ИНТЕЛЛЕКТ</span>
              </div>
              <h4 className="text-white text-sm font-semibold">AI Risk Audit</h4>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Автоматический скоринг рисков перед деплоем через LLM с детекцией критических правок ACL и BGP.
              </p>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-zinc-950/60 border border-white/[0.08] flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center md:text-left">
              <div className="text-xs text-zinc-400 font-mono">СТЕК РЕШЕНИЯ</div>
              <div className="text-sm text-zinc-200 font-medium">
                Python 3.11 • FastAPI • SQLite / PostgreSQL • Celery + Redis • Jinja2 • hier_config • Scrapli • React 19 + Three.js
              </div>
            </div>
            {onLaunchDemo && (
              <button
                onClick={onLaunchDemo}
                className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white text-xs font-semibold tracking-wide uppercase shadow-lg shadow-cyan-500/20 transition flex items-center space-x-2 shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Запустить Живое Демо</span>
              </button>
            )}
          </div>
        </div>
      ),
    },

    // SLIDE 2: 4 Goals from Yandex Annushka
    {
      id: 2,
      category: 'МЕТОДОЛОГИЯ & ПРИНЦИПЫ',
      title: '4 Постулата Автоматизации Сети',
      subtitle: 'Канонический подход управления конфигурациями на гиперскейл-инфраструктуре',
      badge: 'Яндекс Аннушка (Habr)',
      content: (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-cyan-400 text-xs font-bold">01 / ИСТОЧНИК ПРАВДЫ</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Single SoT</span>
            </div>
            <h4 className="text-white text-sm font-semibold">Централизованные изменения</h4>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Все параметры сети (ASN, Router-ID, IP /31, VLAN, ACL) хранятся в репозитории Git в виде чистых структурированных YAML-моделей. Никаких ручных правок в обход репозитория.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-emerald-400 text-xs font-bold">02 / ПРОЗРАЧНОСТЬ</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">Hierarchical Diff</span>
            </div>
            <h4 className="text-white text-sm font-semibold">Видимость изменений до наката</h4>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Инженер и оператор всегда видят точный diff: какие строки удалятся, какие добавятся, и какие точные команды введет драйвер на оборудовании каждого вендора.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-indigo-400 text-xs font-bold">03 / СКОРОСТЬ & БЕЗОПАСНОСТЬ</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">Parallel Deploy</span>
            </div>
            <h4 className="text-white text-sm font-semibold">Параллельный деплой с защитой</h4>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Асинхронные воркеры применяют конфигурацию на весь флот устройств параллельно. Использование сессий и <code>commit confirmed</code> исключает изоляцию устройства при сбоях.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-amber-400 text-xs font-bold">04 / САМОИСЦЕЛЕНИЕ</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">Continuous Drift Guard</span>
            </div>
            <h4 className="text-white text-sm font-semibold">Автоматическое «снуление» дрейфа</h4>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Фоновый Celery Beat опрашивает фабрику, вычисляет расхождение с эталоном и формирует корректирующий remediation-патч, готовый к применению в 1 клик.
            </p>
          </div>
        </div>
      ),
    },

    // SLIDE 3: End-to-End Pipeline
    {
      id: 3,
      category: 'ЖИЗНЕННЫЙ ЦИКЛ',
      title: 'Сквозной Пайплайн Конфигурирования',
      subtitle: 'От коммита в Git до верификации протоколов и подтверждения транзакции',
      badge: 'Zero-Touch Workflow',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              { num: '01', title: 'Git SoT', sub: 'YAML + Lint', icon: GitBranch, color: 'border-cyan-500/40 text-cyan-400' },
              { num: '02', title: 'Jinja2', sub: 'Компиляция', icon: Cpu, color: 'border-purple-500/40 text-purple-400' },
              { num: '03', title: 'Hier Diff', sub: 'hier_config AST', icon: Terminal, color: 'border-indigo-500/40 text-indigo-400' },
              { num: '04', title: 'AI Audit', sub: 'Скоринг рисков', icon: Sparkles, color: 'border-amber-500/40 text-amber-400' },
              { num: '05', title: 'Commit 180s', sub: 'Транзакция', icon: ShieldCheck, color: 'border-emerald-500/40 text-emerald-400' },
              { num: '06', title: 'Telemetry', sub: 'BGP & Link check', icon: Activity, color: 'border-rose-500/40 text-rose-400' },
            ].map((st, i) => {
              const Icon = st.icon;
              return (
                <div key={i} className={`p-3 rounded-xl bg-white/[0.02] border ${st.color} flex flex-col justify-between space-y-2`}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] opacity-75">{st.num}</span>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-white text-xs font-semibold">{st.title}</div>
                    <div className="text-zinc-500 text-[10px] font-mono">{st.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/80 border border-white/[0.08] font-mono text-xs space-y-2 text-zinc-300">
            <div className="text-cyan-400 text-[11px] font-bold flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>СТАТУС ПРОВЕРКИ АВАРИЙНОГО ОТКАТА (SAFETY SHIELD):</span>
            </div>
            <p className="text-zinc-400 leading-relaxed text-[11px]">
              Если на этапе <code>06. Telemetry</code> BGP-соседство не перешло в статус <code>Established</code> или потери пинга превысили 0%, транзакция <strong>автоматически сбрасывается</strong>: оборудование откатывается к гарантированно рабочему состоянию без вмешательства инженера.
            </p>
          </div>
        </div>
      ),
    },

    // SLIDE 4: Heterogeneous Matrix
    {
      id: 4,
      category: 'ГЕТЕРОГЕННОСТЬ',
      title: 'Поддержка 6 Сетевых Платформ',
      subtitle: 'Единая модель намерений компилируется в нативный синтаксис любого вендора',
      badge: 'Multi-Vendor Fabric',
      content: (
        <div className="space-y-4">
          <div className="flex items-center space-x-2 border-b border-white/[0.06] pb-2">
            {[
              { id: 'arista', name: 'Arista EOS' },
              { id: 'cisco', name: 'Cisco IOS-XE' },
              { id: 'juniper', name: 'Juniper Junos' },
              { id: 'eltex', name: 'Eltex MES' },
              { id: 'yadro', name: 'YADRO Kornfe' },
            ].map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveVendorTab(v.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition cursor-pointer ${
                  activeVendorTab === v.id
                    ? 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/90 border border-white/[0.08] font-mono text-xs space-y-3">
            {activeVendorTab === 'arista' && (
              <div className="space-y-2">
                <div className="text-emerald-400 text-[11px]">// Arista cEOS (Spine-1, Spine-2) • BGP EVPN + Section Commit</div>
                <pre className="text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
{`router bgp 65001
   router-id 10.0.0.11
   neighbor 172.20.20.21 remote-as 65002
   neighbor 172.20.20.21 description to_leaf-1
   address-family ipv4
      neighbor 172.20.20.21 activate`}
                </pre>
                <div className="text-[10px] text-zinc-500">Механизм деплоя: Session-based commit с атомарным откатом.</div>
              </div>
            )}

            {activeVendorTab === 'cisco' && (
              <div className="space-y-2">
                <div className="text-cyan-400 text-[11px]">// Cisco IOS-XE (Leaf-1, Leaf-2) • CLOS Fabric + Commit Confirmed</div>
                <pre className="text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
{`router bgp 65002
 bgp log-neighbor-changes
 neighbor 172.20.20.11 remote-as 65001
 address-family ipv4
  neighbor 172.20.20.11 activate
ip access-list extended MGMT-IN
 10 permit tcp 172.20.0.0 0.0.255.255 any eq 22`}
                </pre>
                <div className="text-[10px] text-zinc-500">Механизм деплоя: commit confirmed 180 с автоматическим возвратом.</div>
              </div>
            )}

            {activeVendorTab === 'juniper' && (
              <div className="space-y-2">
                <div className="text-indigo-400 text-[11px]">// Juniper Junos (fw-1, fw-2) • Border Firewall & Hierarchical Policy</div>
                <pre className="text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
{`set routing-options router-id 172.20.20.1
set routing-options autonomous-system 65000
set protocols bgp group FABRIC type external
set protocols bgp group FABRIC neighbor 172.20.20.11 peer-as 65001`}
                </pre>
                <div className="text-[10px] text-zinc-500">Механизм деплоя: commit confirmed 3 с кандидатом конфигурации.</div>
              </div>
            )}

            {activeVendorTab === 'eltex' && (
              <div className="space-y-2">
                <div className="text-amber-400 text-[11px]">// Eltex MES • Российский коммутатор доступа и агрегации</div>
                <pre className="text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
{`router bgp 65003
 neighbor 172.20.20.11 remote-as 65001
 neighbor 172.20.20.11 next-hop-self
 address-family ipv4
  neighbor 172.20.20.11 activate`}
                </pre>
                <div className="text-[10px] text-zinc-500">Механизм деплоя: Copy running-config startup-config после post-check.</div>
              </div>
            )}

            {activeVendorTab === 'yadro' && (
              <div className="space-y-2">
                <div className="text-purple-400 text-[11px]">// YADRO Kornfe • Российский телекоммуникационный маршрутизатор</div>
                <pre className="text-zinc-300 text-[11px] overflow-x-auto leading-relaxed">
{`router bgp 65004
 bgp router-id 10.0.0.31
 neighbor 172.20.20.11 remote-as 65001
 address-family ipv4 unicast
  neighbor 172.20.20.11 activate`}
                </pre>
                <div className="text-[10px] text-zinc-500">Механизм деплоя: Транзакционная трансляция через scrapli CLI driver.</div>
              </div>
            )}
          </div>
        </div>
      ),
    },

    // SLIDE 5: Hierarchical Diff vs Plain Diff
    {
      id: 5,
      category: 'ИНЖЕНЕРНОЕ ЯДРО',
      title: 'Движок Hierarchical Diff (hier_config)',
      subtitle: 'Почему стандартный difflib ломает сетевые ОС и как строится правильный AST-патч',
      badge: 'AST-Based Remediation',
      content: (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-2">
            <div className="flex items-center space-x-2 text-rose-400 text-xs font-mono font-bold">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>ПРОБЛЕМА: ПЛОСКИЙ DIFF (difflib / git diff)</span>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Плоский дифф не понимает контекст команд. Удаление правила в интерфейсе через плоский дифф отправляет команду вне секции, что приводит к <code>% Invalid input detected</code> или сбросу родительского объекта целиком.
            </p>
            <div className="p-2.5 rounded bg-zinc-950 font-mono text-[10px] text-rose-300 border border-rose-900/40">
              - neighbor 10.0.0.1 shutdown<br />
              ! Ошибка: драйвер пытается выполнить команду в корневом режиме!
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
            <div className="flex items-center space-x-2 text-emerald-400 text-xs font-mono font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>РЕШЕНИЕ: HIERARCHICAL DIFF (hier_config)</span>
            </div>
            <p className="text-zinc-400 text-xs leading-relaxed">
              Строит древовидную модель (AST) конфигурации. Патч наката (remediation) и зеркальный патч отката (rollback) всегда сохраняют вложенность секций и порядок ввода вендора.
            </p>
            <div className="p-2.5 rounded bg-zinc-950 font-mono text-[10px] text-emerald-300 border border-emerald-900/40">
              router bgp 65001<br />
              &nbsp;&nbsp;no neighbor 10.0.0.1 shutdown<br />
              ! Корректный контекстный накат с гарантией отката
            </div>
          </div>
        </div>
      ),
    },

    // SLIDE 6: AI Assistant & Risk Scoring
    {
      id: 6,
      category: 'БЕЗОПАСНОСТЬ & AI',
      title: 'LLM Risk Assistant: Автоаудит Изменений',
      subtitle: 'Мгновенный анализ влияния конфигурационных патчей перед утверждением деплоя',
      badge: 'MiMo / Qwen Guard',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <div className="text-[10px] font-mono text-zinc-500 uppercase">Скоринг риска</div>
              <div className="text-white text-xs font-semibold">Категоризация 4 уровней</div>
              <p className="text-zinc-400 text-[11px]">LOW (описание), MEDIUM (BGP таймеры), HIGH (ACL), CRITICAL (изоляция).</p>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <div className="text-[10px] font-mono text-zinc-500 uppercase">Blast Radius</div>
              <div className="text-white text-xs font-semibold">Оценка радиуса поражения</div>
              <p className="text-zinc-400 text-[11px]">Определяет, какие сервисы и соседи затронуты изменениями в CLOS.</p>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <div className="text-[10px] font-mono text-zinc-500 uppercase">План отката</div>
              <div className="text-white text-xs font-semibold">Чек-лист для дежурного</div>
              <p className="text-zinc-400 text-[11px]">Формирует конкретные команды проверки и метрики телеметрии.</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/80 border border-white/[0.08] flex items-center justify-between">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-white">Интеграция с Monaco Diff Viewer</div>
              <div className="text-[11px] text-zinc-400">
                Кнопка «Оценить риски» прямо в интерфейсе согласования запускает LLM-сервис с отказоустойчивым эвристическим фолбэком.
              </div>
            </div>
            {onOpenTab && (
              <button
                onClick={() => onOpenTab('diff')}
                className="px-3.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition cursor-pointer"
              >
                Открыть Diff & AI →
              </button>
            )}
          </div>
        </div>
      ),
    },

    // SLIDE 7: Chaos Lab & Drift Guard
    {
      id: 7,
      category: 'CHAOS ENGINEERING',
      title: 'Chaos Lab: Имитация Аварий и Самоисцеление',
      subtitle: 'Проверка устойчивости сети к внепроцессным изменениям и падению линков',
      badge: 'Drift & Self-Healing',
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
              <div className="flex items-center space-x-2 text-amber-400 text-xs font-mono font-bold">
                <Flame className="w-3.5 h-3.5" />
                <span>ИНЖЕКЦИЯ СБОЕВ</span>
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Интерактивный стенд позволяет в 1 клик сымитировать ручную модификацию ACL на <code>leaf-1</code> или падение интерфейса <code>GigabitEthernet3</code>.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
              <div className="flex items-center space-x-2 text-emerald-400 text-xs font-mono font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>АВТОМАТИЧЕСКАЯ РЕМЕДИАЦИЯ</span>
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Drift Engine обнаруживает несанкционированное правило и генерирует компенсирующий патч (<code>no 15 permit ip any any</code>), возвращая фабрику к эталону.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/80 border border-white/[0.08] flex items-center justify-between">
            <div className="text-xs text-zinc-400">
              Попробуйте сценарии аварий прямо сейчас в интерактивном модуле:
            </div>
            {onOpenTab && (
              <button
                onClick={() => onOpenTab('lab')}
                className="px-3.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-medium transition cursor-pointer"
              >
                Перейти в Тестовый Стенд →
              </button>
            )}
          </div>
        </div>
      ),
    },

    // SLIDE 8: Summary & Hackathon Defense
    {
      id: 8,
      category: 'ИТОГИ & ЗАЩИТА',
      title: 'Готовность к Продакшну и Защите Кейса',
      subtitle: 'Платформа готова к демонстрации перед экспертами хакатона CROC DREAM',
      badge: 'Production Ready',
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="text-2xl font-bold text-cyan-400 font-mono">292/292</div>
              <div className="text-[11px] text-zinc-400 mt-1">Тестов Pytest пройдено</div>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="text-2xl font-bold text-emerald-400 font-mono">6 Нод</div>
              <div className="text-[11px] text-zinc-400 mt-1">CLOS Fabric (Multi-OS)</div>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="text-2xl font-bold text-purple-400 font-mono">&lt; 300мс</div>
              <div className="text-[11px] text-zinc-400 mt-1">Расчет Dry-Run диффа</div>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="text-2xl font-bold text-amber-400 font-mono">0 Ручных</div>
              <div className="text-[11px] text-zinc-400 mt-1">Опасных правок в CLI</div>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-indigo-950/30 to-purple-950/30 border border-cyan-500/30 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center md:text-left">
              <h3 className="text-white text-base font-bold">Готовы увидеть платформу в действии?</h3>
              <p className="text-zinc-300 text-xs">
                Перейдите к интерактивной 3D-топологии и запустите холодный прогон на всех устройствах.
              </p>
            </div>
            {onLaunchDemo && (
              <button
                onClick={onLaunchDemo}
                className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-bold tracking-wider uppercase shadow-xl shadow-cyan-500/25 transition cursor-pointer shrink-0"
              >
                Открыть Консоль Управления ➔
              </button>
            )}
          </div>
        </div>
      ),
    },
  ];

  const current = slides[currentSlide];

  const nextSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev < slides.length - 1 ? prev + 1 : 0));
  }, [slides.length]);

  const prevSlide = useCallback(() => {
    setCurrentSlide((prev) => (prev > 0 ? prev - 1 : slides.length - 1));
  }, [slides.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        nextSlide();
      } else if (e.key === 'ArrowLeft') {
        prevSlide();
      } else if (e.key === 'f' || e.key === 'F') {
        setIsFullscreen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nextSlide, prevSlide]);

  return (
    <div className={`space-y-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-[#08090c] p-6 overflow-y-auto' : ''}`}>
      {/* Slide Navigation Header */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/80 border border-white/[0.08]">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-mono font-bold text-white tracking-wider">
              СЛАЙД {currentSlide + 1} / {slides.length}
            </span>
          </div>
          <span className="text-zinc-600 text-xs">|</span>
          <span className="text-xs text-zinc-400 font-mono hidden sm:inline">{current.category}</span>
        </div>

        {/* Thumbnail Dots */}
        <div className="flex items-center space-x-1.5">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setCurrentSlide(idx)}
              className={`h-2 rounded-full transition-all cursor-pointer ${
                idx === currentSlide ? 'w-6 bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]' : 'w-2 bg-zinc-800 hover:bg-zinc-600'
              }`}
              title={`Слайд ${s.id}: ${s.title}`}
            />
          ))}
        </div>

        {/* Control Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={prevSlide}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/[0.06] transition cursor-pointer"
            title="Предыдущий слайд (←)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={nextSlide}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-white/[0.06] transition cursor-pointer"
            title="Следующий слайд (→ / Space)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.06] transition cursor-pointer"
            title={isFullscreen ? 'Выйти из полноэкранного режима' : 'Полноэкранный режим (F)'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Slide Canvas Card */}
      <div className="p-6 md:p-8 rounded-2xl bg-[#0c0e14] border border-white/[0.08] shadow-2xl relative overflow-hidden min-h-[460px] flex flex-col justify-between">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/[0.03] rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/[0.03] rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-6 relative z-10">
          {/* Header of the slide */}
          <div className="space-y-2 border-b border-white/[0.06] pb-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold tracking-wider text-cyan-400 uppercase">
                {current.category}
              </span>
              {current.badge && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] text-zinc-300 border border-white/[0.08]">
                  {current.badge}
                </span>
              )}
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              {current.title}
            </h2>
            <p className="text-xs md:text-sm text-zinc-400 max-w-3xl leading-relaxed">
              {current.subtitle}
            </p>
          </div>

          {/* Slide Interactive Body */}
          <div className="py-2">{current.content}</div>
        </div>

        {/* Slide Footer */}
        <div className="pt-6 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-500 font-mono relative z-10">
          <div>
            <span>CROC DREAM NetOps • </span>
            <span className="text-zinc-400">Хакатон МТУСИ</span>
          </div>
          <div className="flex items-center space-x-3">
            <span className="hidden md:inline">Навигация: ← / → или Пробел</span>
            <span className="text-cyan-400 font-bold">Слайд {currentSlide + 1} из {slides.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
