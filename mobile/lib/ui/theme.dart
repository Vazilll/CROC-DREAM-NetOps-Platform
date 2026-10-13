import 'package:flutter/material.dart';

class NetOpsTheme {
  // Obsidian Neo-Brutalist Color Scale (SSOT from DESIGN_SYSTEM.md)
  static const Color bgCanvas = Color(0xFF08090C);
  static const Color surfaceCard = Color(0xFF0E1017);
  static const Color surfaceElevated = Color(0xFF141722);
  static const Color borderHairline = Color(0x1AFFFFFF); // 10% white
  static const Color borderHover = Color(0x33FFFFFF);    // 20% white

  // Status & Brand Accents
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
      canvasColor: bgCanvas,
      cardColor: surfaceCard,
      colorScheme: const ColorScheme.dark(
        surface: surfaceCard,
        primary: cyanAction,
        secondary: emeraldSuccess,
        error: roseDanger,
      ),
      fontFamily: 'Segoe UI',
      cardTheme: CardTheme(
        color: surfaceCard,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          side: const BorderSide(color: borderHairline, width: 1),
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: borderHairline,
        thickness: 1,
        space: 1,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          backgroundColor: cyanAction,
          foregroundColor: Colors.black,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.white,
          side: const BorderSide(color: borderHairline),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          textStyle: const TextStyle(fontSize: 13),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceElevated,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borderHairline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borderHairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: cyanAction),
        ),
      ),
    );
  }

  static Color statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'IN_SYNC':
      case 'SUCCESS':
      case 'UP':
        return emeraldSuccess;
      case 'DRIFT_DETECTED':
      case 'WARNING':
      case 'RUNNING':
        return amberWarning;
      case 'UNREACHABLE':
      case 'FAILED':
      case 'DOWN':
      case 'ERROR':
        return roseDanger;
      case 'PENDING':
      case 'IN_PROGRESS':
        return cyanAction;
      default:
        return Colors.grey;
    }
  }
}
