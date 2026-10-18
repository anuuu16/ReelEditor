import { useRef, type RefObject } from "react";
import { SliderField } from "./SliderField.js";
import { ChoiceRow, ColorField, colorAlpha, Section, withAlpha } from "./fields.js";
import {
  BLEND_MODES,
  DEFAULT_SHADOW,
  FONT_FAMILIES,
  SHAPE_TYPES,
  type ImageLayer,
  type Layer,
  type ShapeLayer,
  type TextLayer,
} from "./document.js";
import type { MediaMap } from "./renderImage.js";

interface LayerInspectorProps {
  layer: Layer;
  index: number;
  count: number;
  canvasWidth: number;
  canvasHeight: number;
  media: MediaMap;
  /** Field edits sharing a `key` coalesce into one undo step while the control is being dragged/typed in. */
  onChange: (patch: Partial<Layer>, key?: string) => void;
  onMove: (direction: "up" | "down" | "top" | "bottom") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReplaceImage: (file: File) => void;
  onFitImageAspect: () => void;
  /** The text field is exposed so a double-click on the canvas can focus it. */
  textInputRef: RefObject<HTMLTextAreaElement>;
}

const ROUND = (v: number) => Math.round(v);

export function LayerInspector(props: LayerInspectorProps) {
  const { layer, index, count, canvasWidth: W, canvasHeight: H, onChange, onMove, onDuplicate, onDelete } = props;
  const key = (field: string) => `layer:${layer.id}:${field}`;
  const isLine = layer.kind === "shape" && (layer.shape === "line" || layer.shape === "arrow");

  return (
    <>
      <Section
        title={`${layer.kind} layer`}
        actions={
          <div className="inline-fields ie-section-actions">
            <button type="button" onClick={onDuplicate} title="Duplicate (⌘D)">
              Duplicate
            </button>
            <button type="button" className="project-delete-button" onClick={onDelete} title="Delete (⌫)">
              Delete
            </button>
          </div>
        }
      >
        <label className="field">
          <span>Name</span>
          <input type="text" value={layer.name} onChange={(e) => onChange({ name: e.target.value }, key("name"))} />
        </label>

        <div className="field">
          <span>Order</span>
          <div className="inline-fields">
            <button type="button" disabled={index >= count - 1} onClick={() => onMove("top")}>
              Front
            </button>
            <button type="button" disabled={index >= count - 1} onClick={() => onMove("up")}>
              ↑ Up
            </button>
            <button type="button" disabled={index <= 0} onClick={() => onMove("down")}>
              ↓ Down
            </button>
            <button type="button" disabled={index <= 0} onClick={() => onMove("bottom")}>
              Back
            </button>
          </div>
        </div>

        <div className="inline-fields">
          <button type="button" className={layer.visible ? "" : "active"} onClick={() => onChange({ visible: !layer.visible })}>
            {layer.visible ? "Visible" : "Hidden"}
          </button>
          <button type="button" className={layer.locked ? "active" : ""} onClick={() => onChange({ locked: !layer.locked })}>
            {layer.locked ? "Locked" : "Unlocked"}
          </button>
        </div>
      </Section>

      {layer.kind === "text" && <TextFields layer={layer} W={W} onChange={onChange} keyFor={key} textInputRef={props.textInputRef} />}
      {layer.kind === "shape" && <ShapeFields layer={layer} W={W} onChange={onChange} keyFor={key} />}
      {layer.kind === "image" && (
        <ImageFields
          layer={layer}
          W={W}
          media={props.media}
          onChange={onChange}
          keyFor={key}
          onReplaceImage={props.onReplaceImage}
          onFitImageAspect={props.onFitImageAspect}
        />
      )}

      <Section title="Position & size">
        <div className="inline-fields">
          <label className="field">
            <span>X (center)</span>
            <input type="number" value={ROUND(layer.x * W)} onChange={(e) => onChange({ x: Number(e.target.value) / W }, key("x"))} />
          </label>
          <label className="field">
            <span>Y (center)</span>
            <input type="number" value={ROUND(layer.y * H)} onChange={(e) => onChange({ y: Number(e.target.value) / H }, key("y"))} />
          </label>
        </div>
        <div className="inline-fields">
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              min={1}
              value={ROUND(layer.width * W)}
              onChange={(e) => onChange({ width: Math.max(1, Number(e.target.value)) / W }, key("width"))}
            />
          </label>
          {layer.kind !== "text" && (
            <label className="field">
              <span>{isLine ? "Thickness" : "Height"}</span>
              <input
                type="number"
                min={1}
                value={ROUND(layer.height * H)}
                onChange={(e) => onChange({ height: Math.max(1, Number(e.target.value)) / H }, key("height"))}
              />
            </label>
          )}
        </div>
        <div className="inline-fields inline-fields-wrap">
          <button type="button" onClick={() => onChange({ x: 0.5, y: 0.5 })}>
            Center
          </button>
          <button type="button" onClick={() => onChange({ x: 0.5 })}>
            Center H
          </button>
          <button type="button" onClick={() => onChange({ y: 0.5 })}>
            Center V
          </button>
        </div>
        <SliderField
          label="Rotation"
          value={layer.rotation}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => onChange({ rotation: v }, key("rotation"))}
          format={(v) => `${v}°`}
        />
      </Section>

      <Section title="Effects">
        <ColorField
          label="Shadow"
          value={layer.shadow?.color ?? null}
          allowNone
          fallback="rgba(0,0,0,0.5)"
          onChange={(color) =>
            onChange(
              {
                shadow:
                  color === null
                    ? null
                    : { ...(layer.shadow ?? DEFAULT_SHADOW), color: withAlpha(color, layer.shadow ? colorAlpha(layer.shadow.color) : 0.5) },
              },
              key("shadowColor"),
            )
          }
        />
        {layer.shadow && (
          <>
            <SliderField
              label="Shadow opacity"
              value={colorAlpha(layer.shadow.color)}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onChange({ shadow: { ...layer.shadow!, color: withAlpha(layer.shadow!.color, v) } }, key("shadowAlpha"))}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <SliderField
              label="Shadow blur"
              value={ROUND(layer.shadow.blur * W)}
              min={0}
              max={Math.round(W * 0.08)}
              step={1}
              onChange={(v) => onChange({ shadow: { ...layer.shadow!, blur: v / W } }, key("shadowBlur"))}
              format={(v) => `${v}px`}
            />
            <SliderField
              label="Shadow offset X"
              value={ROUND(layer.shadow.offsetX * W)}
              min={-Math.round(W * 0.05)}
              max={Math.round(W * 0.05)}
              step={1}
              onChange={(v) => onChange({ shadow: { ...layer.shadow!, offsetX: v / W } }, key("shadowX"))}
              format={(v) => `${v}px`}
            />
            <SliderField
              label="Shadow offset Y"
              value={ROUND(layer.shadow.offsetY * W)}
              min={-Math.round(W * 0.05)}
              max={Math.round(W * 0.05)}
              step={1}
              onChange={(v) => onChange({ shadow: { ...layer.shadow!, offsetY: v / W } }, key("shadowY"))}
              format={(v) => `${v}px`}
            />
          </>
        )}
        {layer.kind !== "text" && (
          <div className="inline-fields">
            <button type="button" className={layer.flipH ? "active" : ""} onClick={() => onChange({ flipH: !layer.flipH })}>
              ⇋ Flip H
            </button>
            <button type="button" className={layer.flipV ? "active" : ""} onClick={() => onChange({ flipV: !layer.flipV })}>
              ⇵ Flip V
            </button>
          </div>
        )}
      </Section>

      <Section title="Blend">
        <SliderField
          label="Opacity"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ opacity: v }, key("opacity"))}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <label className="field">
          <span>Blend mode</span>
          <select value={layer.blendMode} onChange={(e) => onChange({ blendMode: e.target.value as Layer["blendMode"] })}>
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
      </Section>
    </>
  );
}

interface KindFieldsProps<L extends Layer> {
  layer: L;
  W: number;
  onChange: (patch: Partial<L>, key?: string) => void;
  keyFor: (field: string) => string;
}

function TextFields({
  layer,
  W,
  onChange,
  keyFor,
  textInputRef,
}: KindFieldsProps<TextLayer> & { textInputRef: RefObject<HTMLTextAreaElement> }) {
  const maxFont = Math.max(48, Math.round(W * 0.4));
  return (
    <Section title="Text">
      <label className="field">
        <span>Text</span>
        <textarea ref={textInputRef} rows={3} value={layer.text} onChange={(e) => onChange({ text: e.target.value }, keyFor("text"))} />
      </label>
      <label className="field">
        <span>Font</span>
        <select value={layer.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
          {FONT_FAMILIES.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </label>
      <SliderField
        label="Size"
        value={ROUND(layer.fontSize * W)}
        min={8}
        max={maxFont}
        step={1}
        onChange={(v) => onChange({ fontSize: v / W }, keyFor("fontSize"))}
        format={(v) => `${v}px`}
      />
      <div className="inline-fields">
        <button type="button" className={layer.bold ? "active" : ""} onClick={() => onChange({ bold: !layer.bold })}>
          Bold
        </button>
        <button type="button" className={layer.italic ? "active" : ""} onClick={() => onChange({ italic: !layer.italic })}>
          Italic
        </button>
      </div>
      <ChoiceRow
        label="Align"
        value={layer.align}
        options={[
          { id: "left", label: "Left" },
          { id: "center", label: "Center" },
          { id: "right", label: "Right" },
        ]}
        onChange={(align) => onChange({ align })}
      />
      <ColorField label="Color" value={layer.color} onChange={(color) => onChange({ color: color ?? "#ffffff" }, keyFor("color"))} />
      <SliderField
        label="Line height"
        value={layer.lineHeight}
        min={0.8}
        max={2}
        step={0.05}
        onChange={(v) => onChange({ lineHeight: v }, keyFor("lineHeight"))}
        format={(v) => `${v.toFixed(2)}×`}
      />
      <SliderField
        label="Padding"
        value={ROUND(layer.padding * W)}
        min={0}
        max={Math.round(W * 0.1)}
        step={1}
        onChange={(v) => onChange({ padding: v / W }, keyFor("padding"))}
        format={(v) => `${v}px`}
      />

      <ColorField
        label="Background"
        value={layer.background}
        allowNone
        fallback="rgba(0,0,0,0.6)"
        onChange={(color) =>
          onChange(
            { background: color === null ? null : withAlpha(color, layer.background ? colorAlpha(layer.background) : 0.6) },
            keyFor("background"),
          )
        }
      />
      {layer.background && (
        <>
          <SliderField
            label="Background opacity"
            value={colorAlpha(layer.background)}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => onChange({ background: withAlpha(layer.background!, v) }, keyFor("backgroundAlpha"))}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <SliderField
            label="Background corners"
            value={ROUND(layer.backgroundRadius * W)}
            min={0}
            max={Math.round(W * 0.1)}
            step={1}
            onChange={(v) => onChange({ backgroundRadius: v / W }, keyFor("backgroundRadius"))}
            format={(v) => `${v}px`}
          />
        </>
      )}

      <ColorField
        label="Outline"
        value={layer.outlineColor}
        allowNone
        fallback="#000000"
        onChange={(color) => onChange({ outlineColor: color }, keyFor("outlineColor"))}
      />
      {layer.outlineColor && (
        <SliderField
          label="Outline width"
          value={Math.round(layer.outlineWidth * W * 10) / 10}
          min={0.5}
          max={Math.max(4, Math.round(W * 0.02))}
          step={0.5}
          onChange={(v) => onChange({ outlineWidth: v / W }, keyFor("outlineWidth"))}
          format={(v) => `${v}px`}
        />
      )}
    </Section>
  );
}

function ShapeFields({ layer, W, onChange, keyFor }: KindFieldsProps<ShapeLayer>) {
  const isLine = layer.shape === "line" || layer.shape === "arrow";
  return (
    <Section title="Shape">
      <ChoiceRow
        value={layer.shape}
        options={SHAPE_TYPES.map((shape) => ({ id: shape, label: shape }))}
        onChange={(shape) => {
          const becomesLine = shape === "line" || shape === "arrow";
          onChange({
            shape,
            // Lines draw with their stroke, filled shapes with their fill — give each a sensible default on switch.
            ...(becomesLine && !layer.stroke ? { stroke: layer.fill ?? "#ffffff" } : {}),
            ...(!becomesLine && !layer.fill && isLine ? { fill: layer.stroke ?? "#5b7cff" } : {}),
            ...(becomesLine !== isLine ? { height: becomesLine ? 0.01 : layer.width * 0.6 } : {}),
          });
        }}
      />
      {!isLine && (
        <>
          <ColorField
            label="Fill"
            value={layer.fill}
            allowNone
            fallback="#5b7cff"
            onChange={(color) =>
              onChange({ fill: color === null ? null : withAlpha(color, layer.fill ? colorAlpha(layer.fill) : 1) }, keyFor("fill"))
            }
          />
          {layer.fill && (
            <SliderField
              label="Fill opacity"
              value={colorAlpha(layer.fill)}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => onChange({ fill: withAlpha(layer.fill!, v) }, keyFor("fillAlpha"))}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
        </>
      )}
      <ColorField
        label={isLine ? "Color" : "Stroke"}
        value={layer.stroke}
        allowNone={!isLine}
        fallback="#ffffff"
        onChange={(color) => onChange({ stroke: color ?? (isLine ? "#ffffff" : null) }, keyFor("stroke"))}
      />
      {layer.stroke && !isLine && (
        <SliderField
          label="Stroke width"
          value={ROUND(layer.strokeWidth * W)}
          min={0}
          max={Math.round(W * 0.05)}
          step={1}
          onChange={(v) => onChange({ strokeWidth: v / W }, keyFor("strokeWidth"))}
          format={(v) => `${v}px`}
        />
      )}
      {layer.shape === "rectangle" && (
        <SliderField
          label="Corner radius"
          value={ROUND(layer.cornerRadius * W)}
          min={0}
          max={Math.round(W * 0.25)}
          step={1}
          onChange={(v) => onChange({ cornerRadius: v / W }, keyFor("cornerRadius"))}
          format={(v) => `${v}px`}
        />
      )}
      {layer.shape === "star" && (
        <SliderField
          label="Points"
          value={layer.points}
          min={3}
          max={24}
          step={1}
          onChange={(v) => onChange({ points: v }, keyFor("points"))}
        />
      )}
    </Section>
  );
}

function ImageFields({
  layer,
  W,
  media,
  onChange,
  keyFor,
  onReplaceImage,
  onFitImageAspect,
}: KindFieldsProps<ImageLayer> & { media: MediaMap; onReplaceImage: (file: File) => void; onFitImageAspect: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const source = media[layer.mediaId];
  return (
    <Section title="Image">
      <div className="ie-image-layer-preview">{source ? <img src={source.url} alt="" /> : <span className="hint">Image missing</span>}</div>
      {source && (
        <p className="hint">
          {source.width}×{source.height}
        </p>
      )}
      <div className="inline-fields">
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Replace…
        </button>
        <button type="button" onClick={onFitImageAspect} disabled={!source}>
          Reset proportions
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onReplaceImage(file);
          e.target.value = "";
        }}
      />
      <SliderField
        label="Corner radius"
        value={ROUND(layer.cornerRadius * W)}
        min={0}
        max={Math.round(W * 0.25)}
        step={1}
        onChange={(v) => onChange({ cornerRadius: v / W }, keyFor("cornerRadius"))}
        format={(v) => `${v}px`}
      />
      <div className="inline-fields">
        <button type="button" className={layer.grayscale ? "active" : ""} onClick={() => onChange({ grayscale: !layer.grayscale })}>
          Grayscale
        </button>
      </div>
    </Section>
  );
}
