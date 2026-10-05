"""Exporte htdemucs en ONNX avec une attention calculée par paquets.

Le modèle ONNX d'origine (timcsy/demucs-web-onnx) calcule chaque attention
du transformer d'un coup : ~230 Mo de scores (8 têtes x 2688 x 2688),
dupliqués par MatMul/Softmax. Une tranche demandait ainsi 2,6-3,2 Go de
mémoire, trop pour un iPhone 13 (l'app native était tuée par iOS).

Ici, nn.MultiheadAttention est remplacé par ChunkedMHA (mêmes poids) qui
traite les requêtes par paquets : résultat mathématiquement identique,
pic mémoire bien plus faible. Entrées/sorties identiques au modèle
d'origine (input/x -> output/add_67), donc separator.js n'a pas à changer.

Usage : python export_htdemucs.py sortie.onnx [taille_des_paquets]
Dépendances : torch==2.2.2, demucs==4.0.1, onnx (cf. README).
"""

import sys

import torch
import torch.nn.functional as F
from demucs.pretrained import get_model
from einops import rearrange
from torch import nn

SEGMENT = 343980
BINS, FRAMES = 2048, 336


class ChunkedMHA(nn.Module):
    def __init__(self, mha: nn.MultiheadAttention, chunk: int):
        super().__init__()
        self.embed_dim = mha.embed_dim
        self.num_heads = mha.num_heads
        self.batch_first = mha.batch_first
        self.chunk = chunk
        self.in_proj_weight = mha.in_proj_weight
        self.in_proj_bias = mha.in_proj_bias
        self.out_proj = mha.out_proj

    def forward(self, query, key, value, attn_mask=None, key_padding_mask=None,
                need_weights=False, is_causal=False, **_):
        assert attn_mask is None and key_padding_mask is None
        if not self.batch_first:
            query, key, value = (t.transpose(0, 1) for t in (query, key, value))
        B, T, E = query.shape
        S = key.shape[1]
        h = self.num_heads
        d = E // h
        w_q, w_k, w_v = self.in_proj_weight.chunk(3)
        b_q, b_k, b_v = self.in_proj_bias.chunk(3)
        q = F.linear(query, w_q, b_q).view(B, T, h, d).transpose(1, 2) * (d ** -0.5)
        k = F.linear(key, w_k, b_k).view(B, S, h, d).transpose(1, 2).transpose(-1, -2)
        v = F.linear(value, w_v, b_v).view(B, S, h, d).transpose(1, 2)
        outs = []
        for start in range(0, T, self.chunk):
            scores = torch.softmax(q[:, :, start:start + self.chunk] @ k, dim=-1)
            outs.append(scores @ v)
        out = torch.cat(outs, dim=2).transpose(1, 2).reshape(B, T, E)
        out = self.out_proj(out)
        if not self.batch_first:
            out = out.transpose(0, 1)
        return out, None


class Core(nn.Module):
    """HTDemucs.forward sans STFT/iSTFT (faits côté JS), comme l'export
    d'origine : (mix, spectrogramme) -> (branche fréquence, branche temps)."""

    def __init__(self, model):
        super().__init__()
        self.m = model

    def forward(self, mix, mag):
        m = self.m
        x = mag
        B, C, Fq, T = x.shape
        mean = x.mean(dim=(1, 2, 3), keepdim=True)
        std = x.std(dim=(1, 2, 3), keepdim=True)
        x = (x - mean) / (1e-5 + std)
        xt = mix
        meant = xt.mean(dim=(1, 2), keepdim=True)
        stdt = xt.std(dim=(1, 2), keepdim=True)
        xt = (xt - meant) / (1e-5 + stdt)

        saved, saved_t, lengths, lengths_t = [], [], [], []
        for idx, encode in enumerate(m.encoder):
            lengths.append(x.shape[-1])
            inject = None
            if idx < len(m.tencoder):
                lengths_t.append(xt.shape[-1])
                tenc = m.tencoder[idx]
                xt = tenc(xt)
                if not tenc.empty:
                    saved_t.append(xt)
                else:
                    inject = xt
            x = encode(x, inject)
            if idx == 0 and m.freq_emb is not None:
                frs = torch.arange(x.shape[-2], device=x.device)
                emb = m.freq_emb(frs).t()[None, :, :, None].expand_as(x)
                x = x + m.freq_emb_scale * emb
            saved.append(x)

        if m.crosstransformer:
            if m.bottom_channels:
                b, c, f, t = x.shape
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_upsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_upsampler_t(xt)
            x, xt = m.crosstransformer(x, xt)
            if m.bottom_channels:
                x = rearrange(x, "b c f t-> b c (f t)")
                x = m.channel_downsampler(x)
                x = rearrange(x, "b c (f t)-> b c f t", f=f)
                xt = m.channel_downsampler_t(xt)

        for idx, decode in enumerate(m.decoder):
            skip = saved.pop(-1)
            x, pre = decode(x, skip, lengths.pop(-1))
            offset = m.depth - len(m.tdecoder)
            if idx >= offset:
                tdec = m.tdecoder[idx - offset]
                length_t = lengths_t.pop(-1)
                if tdec.empty:
                    pre = pre[:, :, 0]
                    xt, _ = tdec(pre, None, length_t)
                else:
                    skip = saved_t.pop(-1)
                    xt, _ = tdec(xt, skip, length_t)

        S = len(m.sources)
        x = x.view(B, S, -1, Fq, T) * std[:, None] + mean[:, None]
        xt = xt.view(B, S, -1, SEGMENT) * stdt[:, None] + meant[:, None]
        return x, xt


def chunk_attention(model, chunk):
    count = 0
    for module in list(model.modules()):
        for name, child in list(module.named_children()):
            if isinstance(child, nn.MultiheadAttention):
                setattr(module, name, ChunkedMHA(child, chunk))
                count += 1
    return count


def main():
    out_path = sys.argv[1]
    chunk = int(sys.argv[2]) if len(sys.argv) > 2 else 256
    model = get_model("htdemucs").models[0].eval()
    replaced = chunk_attention(model, chunk)
    print(f"{replaced} couches d'attention remplacées (paquets de {chunk})")
    core = Core(model).eval()
    mix = torch.randn(1, 2, SEGMENT) * 0.1
    mag = torch.randn(1, 4, BINS, FRAMES) * 0.1
    with torch.no_grad():
        torch.onnx.export(
            core, (mix, mag), out_path,
            input_names=["input", "x"], output_names=["output", "add_67"],
            opset_version=17, do_constant_folding=True,
        )
    print("exporté :", out_path)


if __name__ == "__main__":
    main()
