import { AutoModelForCausalLM, AutoTokenizer } from '@huggingface/transformers';
import type { MtEngine } from '../engines';
import { reportProgress } from './progress';
import type { Device } from './runtime-env';
import type { CausalModel, ChatTokenizer } from './transformers-types';

const MAX_NEW_TOKENS = 160;
const EOS_TOKEN_IDS = [1, 16];
const PAD_TOKEN_ID = 3;

export type Translator = (text: string, targetLang: string) => Promise<string>;

export async function loadPlamoTranslator(engine: MtEngine, device: Device): Promise<Translator> {
  const tokenizer = (await AutoTokenizer.from_pretrained(engine.repo, { progress_callback: reportProgress })) as unknown as ChatTokenizer;
  const model = (await AutoModelForCausalLM.from_pretrained(engine.repo, {
    dtype: engine.dtype as never,
    device,
    progress_callback: reportProgress,
  })) as unknown as CausalModel;

  return async (text, targetLang) => {
    const prompt = tokenizer.apply_chat_template([{ role: 'user', content: text }], {
      tokenize: false,
      add_generation_prompt: true,
      target_lang: targetLang,
    });
    const encoded = tokenizer(prompt, { add_special_tokens: false });
    const length = encoded.input_ids.dims[1] ?? 0;
    const output = await model.generate({
      ...encoded,
      max_new_tokens: MAX_NEW_TOKENS,
      do_sample: false,
      eos_token_id: EOS_TOKEN_IDS,
      pad_token_id: PAD_TOKEN_ID,
    });
    const ids = (output.tolist()[0] ?? []).slice(length).map(Number);
    return tokenizer.decode(ids, { skip_special_tokens: true }).trim();
  };
}
