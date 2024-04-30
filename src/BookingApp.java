import javax.swing.*;
import java.util.*;

public class BookingApp extends JFrame {

    private JPanel BookingPanel;
    private JPanel Meio;
    private JPanel Sul;
    private JPanel MeioNorte;
    private JPanel MeioMeioSul;
    private JButton roomsButton;
    private JButton button1;

    public BookingApp(){
        setContentPane(BookingPanel);
        setTitle("Booking App");
        setDefaultCloseOperation(EXIT_ON_CLOSE);
        setSize(1000, 800);
        setLocationRelativeTo(null);
        setVisible(true);
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            BookingApp app = new BookingApp();
            app.setVisible(true);
        });
    }
}

class Room {
    private int Id;
    private int roomNumber;
    private int adultsCapacity;
    private int childrenCapacity;
    private float price;

    // Construtor
    public Room(int Id, int roomNumber, int adultsCapacity, int childrenCapacity, float price) {
        this.Id = Id;
        this.roomNumber = roomNumber;
        this.adultsCapacity = adultsCapacity;
        this.childrenCapacity = childrenCapacity;
        this.price = price;
    }

    // Getters e Setters


    public void setId(int Id) {
        this.Id = Id;
    }
    public int getRoomNumber() {
        return roomNumber;
    }

    public void setRoomNumber(int roomNumber) {
        this.roomNumber = roomNumber;
    }

    public int getAdultsCapacity() {
        return adultsCapacity;
    }

    public void setAdultsCapacity(int adultsCapacity) {
        this.adultsCapacity = adultsCapacity;
    }

    public int getChildrenCapacity() {
        return childrenCapacity;
    }

    public void setChildrenCapacity(int childrenCapacity) {
        this.childrenCapacity = childrenCapacity;
    }

    public float getPrice() {
        return price;
    }

    public void setPrice(float price) {
        this.price = price;
    }


    public int getId() {
        return Id;
    }
}

class Booking {
    private int Id;
    private int numberOfAdults;
    private int numberOfChildren;
    private int roomId;
    private int statusId;
    private String guestFirstName;
    private String guestLastName;
    private Date checkInDate;
    private Date checkOutDate;

    public Booking() {
        // Construtor vazio
    }

    // Getters e Setters
    public int getId() {
        return Id;
    }

    public void setId(int Id) {
        this.Id = Id;
    }

    public int getNumberOfAdults() {
        return numberOfAdults;
    }

    public void setNumberOfAdults(int numberOfAdults) {
        this.numberOfAdults = numberOfAdults;
    }

    public int getNumberOfChildren() {
        return numberOfChildren;
    }

    public void setNumberOfChildren(int numberOfChildren) {
        this.numberOfChildren = numberOfChildren;
    }

    public int getRoomId() {
        return roomId;
    }

    public void setRoomId(int roomId) {
        this.roomId = roomId;
    }

    public int getStatusId() {
        return statusId;
    }

    public void setStatusId(int statusId) {
        this.statusId = statusId;
    }

    public String getGuestFirstName() {
        return guestFirstName;
    }

    public void setGuestFirstName(String guestFirstName) {
        this.guestFirstName = guestFirstName;
    }

    public String getGuestLastName() {
        return guestLastName;
    }

    public void setGuestLastName(String guestLastName) {
        this.guestLastName = guestLastName;
    }

    public Date getCheckInDate() {
        return checkInDate;
    }

    public void setCheckInDate(Date checkInDate) {
        this.checkInDate = checkInDate;
    }

    public Date getCheckOutDate() {
        return checkOutDate;
    }

    public void setCheckOutDate(Date checkOutDate) {
        this.checkOutDate = checkOutDate;
    }
}

class Status {
    private int Id;
    private String state; // (Booked | CheckedIn | CheckedOut | Canceled)

    public Status(int Id, String state) {
        this.Id = Id;
        this.state = state;
    }

    // Getters e Setters
    public int getId() {
        return Id;
    }

    public void  setId(int Id) {
        this.Id = Id;
    }

    public String getState() {
        return state;

    }
}