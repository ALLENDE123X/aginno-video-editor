import React from 'react';
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToggleButtonProps {
  isVisible: boolean;
  onClick: () => void;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({ isVisible, onClick }) => {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn(
        "fixed right-4 top-20 z-50 transition-all duration-200",
        isVisible ? "bg-primary text-primary-foreground" : "bg-background text-foreground"
      )}
    >
      <Bot className="h-5 w-5" />
    </Button>
  );
};

export default ToggleButton; 