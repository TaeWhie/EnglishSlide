package com.nrc.quiz;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

final class WordLibrary {
    private static final long ONE_DAY_MS = 24L * 60L * 60L * 1000L;

    private WordLibrary() {
    }

    static WordLoadResult loadTodayWords(Context context) {
        List<WordEntry> allWords = new ArrayList<>();
        int resolvedMaxUnit = 1;
        try {
            InputStream input = context.getAssets().open("www/data/words.json");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            JSONArray words = new JSONArray(output.toString(StandardCharsets.UTF_8.name()));
            for (int i = 0; i < words.length(); i++) {
                JSONObject word = words.getJSONObject(i);
                WordEntry entry = new WordEntry(
                        word.optString("word", "benefit"),
                        word.optString("part", "n."),
                        word.optInt("unit", 1),
                        word.optString("korean", "advantage; profit"),
                        word.optString("english", "a good or helpful result")
                );
                resolvedMaxUnit = Math.max(resolvedMaxUnit, entry.unit);
                allWords.add(entry);
            }
        } catch (Exception ignored) {
            allWords.add(fallbackWord());
        }

        int resolvedTodayUnit = unitForToday(resolvedMaxUnit);
        List<WordEntry> resolvedTodayWords = new ArrayList<>();
        for (WordEntry entry : allWords) {
            if (entry.unit == resolvedTodayUnit) {
                resolvedTodayWords.add(entry);
            }
        }
        if (resolvedTodayWords.isEmpty()) {
            resolvedTodayWords.addAll(allWords);
            if (!resolvedTodayWords.isEmpty()) {
                resolvedTodayUnit = resolvedTodayWords.get(0).unit;
            }
        }
        return new WordLoadResult(resolvedTodayWords, resolvedTodayUnit, resolvedMaxUnit);
    }

    static int unitForToday(int cycleMaxUnit) {
        Calendar start = Calendar.getInstance();
        start.set(2026, Calendar.MAY, 5, 0, 0, 0);
        start.set(Calendar.MILLISECOND, 0);

        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0);
        today.set(Calendar.MINUTE, 0);
        today.set(Calendar.SECOND, 0);
        today.set(Calendar.MILLISECOND, 0);

        long dayOffset = (today.getTimeInMillis() - start.getTimeInMillis()) / ONE_DAY_MS;
        return (int) Math.floorMod(dayOffset, Math.max(1, cycleMaxUnit)) + 1;
    }

    static WordEntry fallbackWord() {
        return new WordEntry("benefit", "n.", 1, "advantage; profit", "a good or helpful result");
    }

    static final class WordEntry {
        final String word;
        final String part;
        final int unit;
        final String korean;
        final String english;

        WordEntry(String word, String part, int unit, String korean, String english) {
            this.word = word;
            this.part = part;
            this.unit = unit;
            this.korean = korean;
            this.english = english;
        }
    }

    static final class WordLoadResult {
        final List<WordEntry> words;
        final int todayUnit;
        final int maxUnit;

        WordLoadResult(List<WordEntry> words, int todayUnit, int maxUnit) {
            this.words = words;
            this.todayUnit = todayUnit;
            this.maxUnit = maxUnit;
        }
    }
}
