import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Field, SliderField, ToggleField } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Tabs } from '@/components/ui/tabs'
import { formatNumber } from '@/lib/utils'
import { useAppStore } from '@/stores/app'

type Section = 'general' | 'project' | 'model' | 'retrieval' | 'appearance'

export function Settings(): JSX.Element {
  const { settings, updateSettings, project, info } = useAppStore()
  const [section, setSection] = useState<Section>('general')

  const retrieval = settings.retrieval
  const model = settings.model
  const general = settings.general
  const appearance = settings.appearance

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <Tabs
          items={[
            { value: 'general', label: 'General' },
            { value: 'project', label: 'Project' },
            { value: 'model', label: 'Model' },
            { value: 'retrieval', label: 'Retrieval' },
            { value: 'appearance', label: 'Appearance' }
          ]}
          value={section}
          onChange={setSection}
        />

        {section === 'general' ? (
          <Card className="space-y-4 p-4">
            <ToggleField
              label="Reindex when a project is opened"
              hint="Only changed files are reparsed — unchanged content is skipped by content hash."
              checked={general.reindexOnOpen}
              onChange={(reindexOnOpen) => void updateSettings({ general: { reindexOnOpen } })}
            />
            <Field label="File extensions" hint="Comma separated. PDF support is planned but not enabled yet.">
              <Input
                defaultValue={general.extensions.join(', ')}
                onBlur={(event) =>
                  void updateSettings({
                    general: {
                      extensions: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean)
                    }
                  })
                }
              />
            </Field>
            <Field label="Ignored directories">
              <Input
                defaultValue={general.ignoredDirectories.join(', ')}
                onBlur={(event) =>
                  void updateSettings({
                    general: {
                      ignoredDirectories: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean)
                    }
                  })
                }
              />
            </Field>
            <SliderField
              label="Max file size"
              value={general.maxFileSizeKb}
              min={64}
              max={8192}
              step={64}
              format={(value) => `${formatNumber(value)} KB`}
              onChange={(maxFileSizeKb) => void updateSettings({ general: { maxFileSizeKb } })}
            />
          </Card>
        ) : null}

        {section === 'project' ? (
          <Card className="space-y-3 p-4 text-[12.5px]">
            {project ? (
              <dl className="space-y-2">
                {[
                  ['Name', project.name],
                  ['Folder', project.path],
                  ['Documents', formatNumber(project.stats.documents)],
                  ['Sections', formatNumber(project.stats.sections)],
                  ['Words', formatNumber(project.stats.words)]
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-4">
                    <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-muted-foreground">No project is open.</p>
            )}
            <div className="border-t border-border pt-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Database</p>
              <p className="mt-1 break-all font-mono text-[11px]">{info?.databasePath ?? '—'}</p>
            </div>
          </Card>
        ) : null}

        {section === 'model' ? (
          <Card className="space-y-4 p-4">
            <Field label="Provider">
              <Select
                value={model.provider}
                onChange={(event) => void updateSettings({ model: { provider: event.target.value } })}
              >
                <option value="none">Retrieval only (no model)</option>
                <option value="local-gguf">Local GGUF (llama.cpp)</option>
                <option value="ollama">Ollama</option>
              </Select>
            </Field>
            <Field label="GGUF model path" hint="Pick a file on the Model page to fill this in.">
              <Input
                value={model.modelPath}
                onChange={(event) => void updateSettings({ model: { modelPath: event.target.value } })}
                placeholder="/path/to/model.gguf"
              />
            </Field>
            <SliderField
              label="Context size"
              hint="Tokens the model can hold. Larger contexts need more memory."
              value={model.contextSize}
              min={1024}
              max={32768}
              step={512}
              format={formatNumber}
              onChange={(contextSize) => void updateSettings({ model: { contextSize } })}
            />
            <SliderField
              label="Temperature"
              hint="Keep it low: the answer must follow the documentation, not improvise."
              value={model.temperature}
              min={0}
              max={1.2}
              step={0.05}
              format={(value) => value.toFixed(2)}
              onChange={(temperature) => void updateSettings({ model: { temperature } })}
            />
            <SliderField
              label="Max generated tokens"
              value={model.maxTokens}
              min={128}
              max={4096}
              step={64}
              format={formatNumber}
              onChange={(maxTokens) => void updateSettings({ model: { maxTokens } })}
            />
            <SliderField
              label="CPU threads"
              hint="0 lets llama.cpp choose."
              value={model.threads}
              min={0}
              max={16}
              onChange={(threads) => void updateSettings({ model: { threads } })}
            />
            <SliderField
              label="GPU layers"
              hint="-1 offloads as much as the GPU allows (Metal / CUDA)."
              value={model.gpuLayers}
              min={-1}
              max={100}
              onChange={(gpuLayers) => void updateSettings({ model: { gpuLayers } })}
            />
            <Field label="Ollama URL">
              <Input
                value={model.ollamaUrl}
                onChange={(event) => void updateSettings({ model: { ollamaUrl: event.target.value } })}
              />
            </Field>
          </Card>
        ) : null}

        {section === 'retrieval' ? (
          <Card className="space-y-4 p-4">
            <SliderField
              label="Max sections in context"
              value={retrieval.maxSections}
              min={1}
              max={20}
              onChange={(maxSections) => void updateSettings({ retrieval: { maxSections } })}
            />
            <SliderField
              label="Min sections in context"
              value={retrieval.minSections}
              min={1}
              max={10}
              onChange={(minSections) => void updateSettings({ retrieval: { minSections } })}
            />
            <SliderField
              label="Max context characters"
              hint="Hard ceiling on the prompt. Sections beyond it are truncated or dropped."
              value={retrieval.maxContextChars}
              min={2000}
              max={60000}
              step={1000}
              format={formatNumber}
              onChange={(maxContextChars) => void updateSettings({ retrieval: { maxContextChars } })}
            />
            <SliderField
              label="Candidate limit"
              hint="How many sections each search pass may return before ranking."
              value={retrieval.candidateLimit}
              min={20}
              max={300}
              step={10}
              onChange={(candidateLimit) => void updateSettings({ retrieval: { candidateLimit } })}
            />
            <div className="border-t border-border pt-3">
              <p className="mb-3 text-[10px] uppercase tracking-wider text-muted-foreground/70">Ranking weights</p>
              <div className="space-y-4">
                <SliderField
                  label="Exact symbol match boost"
                  value={retrieval.exactMatchBoost}
                  min={0}
                  max={8}
                  step={0.1}
                  format={(value) => value.toFixed(1)}
                  onChange={(exactMatchBoost) => void updateSettings({ retrieval: { exactMatchBoost } })}
                />
                <SliderField
                  label="Heading boost"
                  value={retrieval.headingBoost}
                  min={0}
                  max={8}
                  step={0.1}
                  format={(value) => value.toFixed(1)}
                  onChange={(headingBoost) => void updateSettings({ retrieval: { headingBoost } })}
                />
                <SliderField
                  label="Filename boost"
                  value={retrieval.filenameBoost}
                  min={0}
                  max={8}
                  step={0.1}
                  format={(value) => value.toFixed(1)}
                  onChange={(filenameBoost) => void updateSettings({ retrieval: { filenameBoost } })}
                />
                <SliderField
                  label="FTS/BM25 weight"
                  value={retrieval.ftsWeight}
                  min={0}
                  max={8}
                  step={0.1}
                  format={(value) => value.toFixed(1)}
                  onChange={(ftsWeight) => void updateSettings({ retrieval: { ftsWeight } })}
                />
                <SliderField
                  label="Keyword overlap weight"
                  value={retrieval.keywordWeight}
                  min={0}
                  max={8}
                  step={0.1}
                  format={(value) => value.toFixed(1)}
                  onChange={(keywordWeight) => void updateSettings({ retrieval: { keywordWeight } })}
                />
              </div>
            </div>
          </Card>
        ) : null}

        {section === 'appearance' ? (
          <Card className="space-y-4 p-4">
            <Field label="Theme">
              <Select
                value={appearance.theme}
                onChange={(event) => void updateSettings({ appearance: { theme: event.target.value } })}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </Select>
            </Field>
            <Field label="Accent">
              <Select
                value={appearance.accent}
                onChange={(event) => void updateSettings({ appearance: { accent: event.target.value } })}
              >
                <option value="violet">Violet</option>
                <option value="cyan">Cyan</option>
                <option value="amber">Amber</option>
                <option value="emerald">Emerald</option>
              </Select>
            </Field>
            <ToggleField
              label="Show the retrieval graph"
              hint="The graph renders the real pipeline events for the current question."
              checked={appearance.showGraph}
              onChange={(showGraph) => void updateSettings({ appearance: { showGraph } })}
            />
            <ToggleField
              label="Compact density"
              hint="Tightens spacing across the workspace."
              checked={appearance.compact}
              onChange={(compact) => void updateSettings({ appearance: { compact } })}
            />
          </Card>
        ) : null}
      </div>
    </div>
  )
}
