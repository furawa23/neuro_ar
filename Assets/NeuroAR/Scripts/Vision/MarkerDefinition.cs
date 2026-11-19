using System;
using System.Collections.Generic;

namespace NeuroAR.Vision
{
    /// <summary>The printed square's black outer edge is 14 cm wide; 1 denotes a white cell.</summary>
    public static class MarkerDefinition
    {
        public const int GridSize = 7;
        public const double WidthMeters = 0.14;
        private static readonly IReadOnlyList<string> payloadRows = Array.AsReadOnly(new[]
        {
            "10110", "01101", "11000", "00111", "10010"
        });

        public static IReadOnlyList<string> PayloadRows { get { return payloadRows; } }

        public static bool IsWhite(int row, int column)
        {
            if (row < 0 || row >= GridSize) throw new ArgumentOutOfRangeException(nameof(row));
            if (column < 0 || column >= GridSize) throw new ArgumentOutOfRangeException(nameof(column));
            return row > 0 && row < GridSize - 1 && column > 0 && column < GridSize - 1
                && payloadRows[row - 1][column - 1] == '1';
        }
    }
}
