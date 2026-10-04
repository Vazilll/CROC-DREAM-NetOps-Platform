import 'package:flutter/material.dart';

class NetOpsTheme {
  // Obsidian Neo-Brutalist Color Scale (SSOT from DESIGN_SYSTEM.md)
  static const Color bgCanvas = Color(0xFF08090C);
  static const Color surfaceCard = Color(0xFF0E1017);
  static const Color surfaceElevated = Color(0xFF141722);
  static const Color borderHairline = Color(0x14FFFFFF);
  static const Color borderHover = Color(0x29FFFFFF);

  // Status Accents
  static const Color emeraldSuccess = Color(0xFF10B981);
  static const Color cyanAction = Color(0xFF06B6D4);
  static const Color amberWarning = Color(0xFFF59E0B);
  static const Color roseDanger = Color(0xFFF43F5E);
  static const Color violetAi = Color(0xFF8B5CF6);

  static ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: bgCanvas,
      primaryColor: cyanAction,
      cardColor: surfaceCard,
      colorScheme: const ColorScheme.dark(
        background: bgCanvas,
        surface: surfaceCard,
        primary: cyanAction,
        secondary: emeraldSuccess,
        error: roseDanger,
      ),
      fontFamily: 'Inter',
      cardTheme: CardTheme(
        color: surfaceCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          side: const BorderSide(color: borderHairline, width: 1),
          borderRadius: BorderRadius.circular(12),
        ),
      ),
    );
  }
}
